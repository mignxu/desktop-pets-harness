// Claude Code adapter:官方 Agent SDK → 壳的统一契约。
// 翻译规则见笔记 6.3:文本用流式增量,工具以 assistant/user 完整消息为准(稳)。
'use strict';

const { randomUUID } = require("node:crypto");

const SHELL_TOOLS = new Set(["Bash"]);
const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

// 会话级 settings:把壳注入的 API 配置( store/api-config.json → 进程环境 )以最高优先级
// (flag settings 层)传给 CLI,避免被用户全局 ~/.claude/settings.json 的 env 块覆盖。
// 注意:必须惰性计算——本模块被 require 时 applyApiConfig() 还没跑,进程环境尚未注入。
function relaySettings() {
  if (!process.env.ANTHROPIC_BASE_URL) return undefined;
  return {
    env: {
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
      // 兼容国产模型中转:MiniMax 等只认 thinking type=开启/关闭/自动,
      // CLI 默认的思考配置会 400,这里显式关闭扩展思考
      MAX_THINKING_TOKENS: "0",
      ...(process.env.ANTHROPIC_AUTH_TOKEN ? { ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN } : {}),
      ...(process.env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } : {}),
      ...(process.env.ANTHROPIC_MODEL
        ? {
            ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
            ANTHROPIC_DEFAULT_SONNET_MODEL: process.env.ANTHROPIC_MODEL,
            ANTHROPIC_DEFAULT_OPUS_MODEL: process.env.ANTHROPIC_MODEL,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: process.env.ANTHROPIC_MODEL,
          }
        : {}),
    },
  };
}

function summarizeToolInput(toolName, input = {}) {
  if (toolName === "Bash") return `$ ${input.command ?? ""}`;
  if (FILE_TOOLS.has(toolName)) return `${toolName}: ${input.file_path ?? input.notebook_path ?? ""}`;
  if (toolName === "Read") return `Read: ${input.file_path ?? ""}`;
  const first = typeof input === "object" ? JSON.stringify(input) : String(input);
  return `${toolName}: ${first.slice(0, 120)}`;
}

function textOfToolResult(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part?.type === "text" ? part.text : `[${part?.type ?? "unknown"}]`))
      .join("\n");
  }
  return "";
}

class ClaudeCodeSession {
  constructor({ threadId, cwd, model, emit }) {
    this.threadId = threadId;
    this.cwd = cwd;
    this.model = model;
    this.emit = emit; // (contractEvent) => void
    this.abort = null;
    this.running = false;
    this.inThink = false;
    this.byToolUseId = new Map(); // SDK tool_use id -> itemId
    this.approvals = new Map();   // interactionId -> resolve({behavior})
  }

  async start(text) {
    if (this.running) throw new Error("turn already running");
    this.running = true;
    this.abort = new AbortController();
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    this.emit({ type: "turn.started", threadId: this.threadId });
    const settings = relaySettings();
    const iterator = query({
      prompt: text,
      options: {
        cwd: this.cwd,
        ...(this.model ? { model: this.model } : {}),
        abortController: this.abort,
        permissionMode: "default",
        includePartialMessages: true,
        ...(settings ? { settings } : {}),
        canUseTool: (toolName, input) => this.requestApproval(toolName, input),
      },
    });
    this.consume(iterator).catch((error) => this.fail(error));
  }

  // ---- 审批:SDK canUseTool 回调 → 契约 interaction → 等面板决定 ----
  async requestApproval(toolName, input) {
    const interactionId = randomUUID();
    // 先注册审批、再广播:否则 publish 计算 pending 时 Map 为空,宠物收不到气泡
    let resolveApproval;
    const decisionPromise = new Promise((resolve) => { resolveApproval = resolve; });
    this.approvals.set(interactionId, resolveApproval);
    this.emit({
      type: "interaction.opened",
      threadId: this.threadId,
      interaction: {
        interactionId,
        kind: "approval",
        toolName,
        summary: summarizeToolInput(toolName, input),
        detail: input,
      },
    });
    const decision = await decisionPromise;
    this.emit({
      type: "interaction.closed",
      threadId: this.threadId,
      interactionId,
      resolution: decision.behavior === "allow" ? "allowed" : "denied",
    });
    return decision.behavior === "allow"
      ? { behavior: "allow", updatedInput: input }
      : { behavior: "deny", message: "用户在面板中拒绝了该操作" };
  }

  respond(interactionId, behavior) {
    const resolve = this.approvals.get(interactionId);
    if (!resolve) return false;
    this.approvals.delete(interactionId);
    resolve({ behavior });
    return true;
  }

  pendingApprovals() {
    return this.approvals.size;
  }

  stop() {
    this.abort?.abort(new Error("user-cancel"));
    for (const [id, resolve] of [...this.approvals]) {
      this.approvals.delete(id);
      resolve({ behavior: "deny" });
    }
  }

  async consume(iterator) {
    try {
      for await (const message of iterator) this.translate(message);
    } catch (error) {
      if (this.abort?.signal.aborted) {
        this.emit({
          type: "turn.completed",
          threadId: this.threadId,
          outcome: { status: "cancelled", reason: "用户停止" },
        });
      } else {
        this.fail(error);
      }
    } finally {
      this.running = false;
    }
  }

  // ---- 翻译:SDK 消息 → 契约事件 ----
  translate(message) {
    switch (message.type) {
      case "system":
        if (message.subtype === "init") {
          this.emit({
            type: "thread.meta",
            threadId: this.threadId,
            meta: { model: message.model, cwd: message.cwd ?? this.cwd },
          });
        }
        return;

      case "stream_event": {
        const event = message.event ?? {};
        if (event.type === "content_block_start" && event.content_block?.type === "text") {
          this.startAgentMessage();
        }
        if (event.type === "content_block_delta") {
          if (event.delta?.type === "text_delta" && event.delta.text) {
            this.appendTextSplittingThink(event.delta.text);
          }
          if (event.delta?.type === "thinking_delta" && event.delta.thinking) {
            this.appendReasoning(event.delta.thinking);
          }
        }
        return;
      }

      case "assistant": {
        const blocks = message.message?.content ?? [];
        for (const block of blocks) {
          if (block.type === "text") {
            // 流式已增量输出的内容不重复追加(assistant 完整消息是同一份文本)
            if (this.textItemId) {
              this.completeItem(this.textItemId, "succeeded");
            } else {
              this.startAgentMessage();
              this.appendTextSplittingThink(block.text);
              this.completeItem(this.textItemId, "succeeded");
            }
          } else if (block.type === "thinking") {
            if (!this.reasoningItemId) this.appendReasoning(block.thinking ?? "");
            if (this.reasoningItemId) this.completeItem(this.reasoningItemId, "succeeded");
          } else if (block.type === "tool_use") {
            this.startToolItem(block.id, block.name, block.input ?? {});
          }
        }
        return;
      }

      case "user": {
        const blocks = message.message?.content ?? [];
        if (!Array.isArray(blocks)) return;
        for (const block of blocks) {
          if (block.type !== "tool_result") continue;
          const itemId = this.byToolUseId.get(block.tool_use_id);
          if (!itemId) continue;
          const output = textOfToolResult(block.content);
          this.emit({
            type: "item.updated",
            threadId: this.threadId,
            itemId,
            patch: { output: output.slice(0, 6000), status: block.is_error ? "failed" : "succeeded" },
          });
          this.completeItem(itemId, block.is_error ? "failed" : "succeeded");
        }
        return;
      }

      case "result": {
        this.sawResult = true;
        this.emit({
          type: "turn.completed",
          threadId: this.threadId,
          outcome: {
            status: message.is_error ? "failed" : "succeeded",
            ...(message.result ? { result: String(message.result).slice(0, 500) } : {}),
            usage: {
              inputTokens: message.usage?.input_tokens ?? null,
              outputTokens: message.usage?.output_tokens ?? null,
              costUsd: message.total_cost_usd ?? null,
              ...(message.is_error && message.result ? { error: String(message.result).slice(0, 300) } : {}),
            },
          },
        });
        return;
      }
    }
  }

  // MiniMax 等国产模型把思考以 <think>…</think> 混在正文流里:
  // 拆开,思考进 reasoning 条目,正文保持干净(标签跨增量分片的场景按普通文本放行)
  appendTextSplittingThink(delta) {
    let rest = delta;
    while (rest) {
      if (!this.inThink) {
        const open = rest.indexOf("<think>");
        if (open === -1) { this.appendAgentMessage(rest); return; }
        if (open > 0) this.appendAgentMessage(rest.slice(0, open));
        this.inThink = true;
        rest = rest.slice(open + 7);
      } else {
        const close = rest.indexOf("</think>");
        if (close === -1) { this.appendReasoning(rest); return; }
        if (close > 0) this.appendReasoning(rest.slice(0, close));
        this.inThink = false;
        this.completeItem(this.reasoningItemId, "succeeded");
        rest = rest.slice(close + 8);
      }
    }
  }

  // ---- item 辅助 ----
  startAgentMessage() {
    if (this.textItemId) return;
    const item = { itemId: randomUUID(), type: "agentMessage", text: "" };
    this.textItemId = item.itemId;
    this.emit({ type: "item.started", threadId: this.threadId, item });
  }

  appendAgentMessage(text) {
    if (!this.textItemId || !text) return;
    this.emit({ type: "item.updated", threadId: this.threadId, itemId: this.textItemId, patch: { textDelta: text } });
  }

  appendReasoning(text) {
    if (!text) return;
    if (!this.reasoningItemId) {
      const item = { itemId: randomUUID(), type: "reasoning", text: "" };
      this.reasoningItemId = item.itemId;
      this.emit({ type: "item.started", threadId: this.threadId, item });
    }
    this.emit({ type: "item.updated", threadId: this.threadId, itemId: this.reasoningItemId, patch: { textDelta: text } });
  }

  startToolItem(toolUseId, toolName, input) {
    if (this.byToolUseId.has(toolUseId)) return this.byToolUseId.get(toolUseId);
    const isShell = SHELL_TOOLS.has(toolName);
    const isFile = FILE_TOOLS.has(toolName);
    const item = {
      itemId: randomUUID(),
      type: isShell ? "commandExecution" : isFile ? "fileChange" : "toolExecution",
      ...(isShell ? { command: input.command ?? "", cwd: this.cwd } : { toolName, arguments: input }),
      ...(isFile ? { path: input.file_path ?? input.notebook_path ?? "", toolName } : {}),
      status: "inProgress",
    };
    this.byToolUseId.set(toolUseId, item.itemId);
    this.emit({ type: "item.started", threadId: this.threadId, item });
    return item.itemId;
  }

  completeItem(itemId, status) {
    if (!itemId) return;
    if (itemId === this.textItemId) this.textItemId = null;
    if (itemId === this.reasoningItemId) this.reasoningItemId = null;
    this.emit({ type: "item.completed", threadId: this.threadId, itemId, status });
  }

  fail(error) {
    if (this.sawResult) return; // result 已发,is_error 的失败已随 turn.completed 上报,SDK 事后抛错不重复计
    this.emit({
      type: "turn.failed",
      threadId: this.threadId,
      error: String(error?.message ?? error).slice(0, 400),
    });
  }
}

module.exports = { ClaudeCodeSession, summarizeToolInput };
