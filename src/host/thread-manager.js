// ThreadManager:契约事件的事实源。
// 职责:持有会话、落事件日志、推导 Thread 状态、聚合宠物状态、向两条渲染层总线广播。
'use strict';

const { ClaudeCodeSession } = require("../adapter/claude-code.js");
const { MockSession } = require("../adapter/mock.js");
const { aggregateStates } = require("../shared/contracts.js");
const { validateContractEvent } = require("../shared/eventSchemas.js");
const { getCapabilities } = require("../shared/capabilities.js");

// MOCK_TURN=1 时用模拟 adapter(演示/联调 UI 与审批闭环,无需真实凭据)
const SessionImpl = process.env.MOCK_TURN === "1" ? MockSession : ClaudeCodeSession;

class ThreadManager {
  constructor({ broadcast }) {
    this.threads = new Map(); // threadId -> thread
    this.broadcast = broadcast; // (channel, payload) => void
  }

  createThread({ harnessId = "claude-code", cwd, model, title }) {
    const threadId = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const thread = {
      threadId,
      harnessId,
      cwd,
      model,
      title: title ?? "新对话",
      state: "idle",
      log: [],
      session: null,
      usage: null,
      meta: null,
    };
    this.threads.set(threadId, thread);
    this.publish();
    return thread;
  }

  get(threadId) {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`unknown thread ${threadId}`);
    return thread;
  }

  startTurn(threadId, text) {
    const thread = this.get(threadId);
    if (thread.session?.running) throw new Error("thread busy");
    if (thread.state === "error" || !thread.session) {
      thread.session = new SessionImpl({
        threadId,
        cwd: thread.cwd,
        model: thread.model,
        emit: (event) => this.handleEvent(event),
      });
    }
    thread.session.start(text).catch(() => {}); // consume 内部已 fail()
    thread.log.push({ __user: true, threadId, text });
    this.publish({ __user: true, threadId, text });
  }

  respond(threadId, interactionId, behavior) {
    const thread = this.get(threadId);
    return thread.session?.respond(interactionId, behavior) ?? false;
  }

  stopTurn(threadId) {
    this.get(threadId).session?.stop();
  }

  handleEvent(event) {
    const thread = this.threads.get(event.threadId);
    if (!thread) return;
    // 契约校验:非致命,仅报错(不阻断事件流),用于捕获 adapter 翻译回归
    const vr = validateContractEvent(event);
    if (!vr.ok) {
      console.error("[contract] 事件不符合契约:", vr.errors.join("; "), "→", JSON.stringify(event).slice(0, 300));
    }
    thread.log.push(event);

    switch (event.type) {
      case "turn.started":
        thread.state = "working";
        break;
      case "thread.meta":
        thread.meta = event.meta;
        break;
      case "interaction.opened":
        thread.state = "waitingInteraction";
        break;
      case "interaction.closed":
        if (thread.session?.pendingApprovals() === 0) thread.state = "working";
        break;
      case "turn.completed": {
        thread.usage = event.outcome.usage ?? thread.usage;
        const failed = event.outcome.status === "failed";
        thread.state = failed ? "error" : "idle";
        break;
      }
      case "turn.failed":
        thread.state = "error";
        break;
    }
    this.publish(event);
  }

  // 聚合宠物状态 + 待审批清单,推给宠物窗;事件流推给面板。
  publish(latestEvent) {
    const threads = [...this.threads.values()];
    const petState = aggregateStates(threads.map((t) => t.state));
    const pending = threads
      .flatMap((t) =>
        collectPendingInteractions(t).map(({ interaction }) => ({
          threadId: t.threadId,
          title: t.title,
          interactionId: interaction.interactionId,
          toolName: interaction.toolName,
          summary: interaction.summary,
        })));
    this.broadcast("contract:event", latestEvent ?? null);
    this.broadcast("panel:snapshot-dirty");
    this.broadcast("pet:state", { state: petState, pending });
  }

  snapshot() {
    const threads = [...this.threads.values()].map((t) => ({
      threadId: t.threadId,
      title: t.title,
      harnessId: t.harnessId,
      state: t.state,
      model: t.meta?.model ?? t.model ?? null,
      cwd: t.cwd,
      usage: t.usage,
      pending: collectPendingInteractions(t).length,
    }));
    const log = Object.fromEntries([...this.threads.values()].map((t) => [t.threadId, t.log]));
    // 能力表:面板据此做 UI 降级(审批/流式开关等)。harness 单一,取当前生效的那条。
    const capabilities = getCapabilities("claude-code", { mock: process.env.MOCK_TURN === "1" });
    return { threads, log, capabilities };
  }

  // ---- 会话持久化:落盘 / 恢复(事件日志可完整重放,面板 renderAll 直接吃) ----
  serialize() {
    return {
      savedAt: new Date().toISOString(),
      threads: [...this.threads.values()].map((t) => ({
        threadId: t.threadId,
        title: t.title,
        harnessId: t.harnessId,
        cwd: t.cwd,
        model: t.model,
        usage: t.usage,
        meta: t.meta,
        // 运行中/等待中的会话在重启后无法续跑,统一归位 idle(日志保留可回看)
        state: t.state === "working" || t.state === "waitingInteraction" ? "idle" : t.state,
        log: t.log,
      })),
    };
  }

  loadThreads(data) {
    if (!data || !Array.isArray(data.threads)) return 0;
    let count = 0;
    for (const t of data.threads) {
      if (!t || typeof t.threadId !== "string" || !Array.isArray(t.log)) continue;
      this.threads.set(t.threadId, { ...t, state: "idle", session: null });
      count += 1;
    }
    return count;
  }
}

function collectPendingInteractions(thread) {
  if (!thread.session) return [];
  return [...thread.session.approvals.keys()].map((interactionId) => ({
    thread,
    interaction: {
      interactionId,
      toolName: findInteraction(thread.log, interactionId)?.toolName ?? "tool",
      summary: findInteraction(thread.log, interactionId)?.summary ?? "",
    },
  }));
}

function findInteraction(log, interactionId) {
  for (let i = log.length - 1; i >= 0; i--) {
    const event = log[i];
    if (event.type === "interaction.opened" && event.interaction.interactionId === interactionId) {
      return event.interaction;
    }
  }
  return null;
}

module.exports = { ThreadManager };
