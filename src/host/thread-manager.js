// ThreadManager:契约事件的事实源。
// 职责:持有会话、落事件日志、推导 Thread 状态、聚合宠物状态、向两条渲染层总线广播。
'use strict';

const { ClaudeCodeSession } = require("../adapter/claude-code.js");
const { aggregateStates } = require("../shared/contracts.js");

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
      thread.session = new ClaudeCodeSession({
        threadId,
        cwd: thread.cwd,
        model: thread.model,
        emit: (event) => this.handleEvent(event),
      });
    }
    thread.session.start(text).catch(() => {}); // consume 内部已 fail()
    if (!thread.log.some((e) => e.__user)) {
      // 用户输入进日志,面板才有所显
      thread.log.push({ __user: true, text });
    }
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
      .flatMap((t) => collectPendingInteractions(t))
      .map(({ threadId, title, interaction }) => ({
        threadId,
        title,
        interactionId: interaction.interactionId,
        toolName: interaction.toolName,
        summary: interaction.summary,
      }));
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
    return { threads, log };
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
