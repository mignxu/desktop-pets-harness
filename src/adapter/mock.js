// 模拟 adapter:不接真实 harness,按壳的契约事件时序演出一轮完整 turn(含真实审批暂停)。
// 用途:--mock / MOCK_TURN=1 时演示与联调 UI、宠物状态、审批闭环,无需真实凭据。
'use strict';

const { randomUUID } = require("node:crypto");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class MockSession {
  constructor({ threadId, emit }) {
    this.threadId = threadId;
    this.emit = emit;
    this.approvals = new Map();
    this.running = false;
    this.cancelled = false;
  }

  item(type, extra) {
    return { itemId: randomUUID(), type, ...extra };
  }

  async start(text) {
    if (this.running) throw new Error("turn already running");
    this.running = true;
    this.cancelled = false;
    this.emit({ type: "turn.started", threadId: this.threadId });
    this.run(text).catch((error) => {
      this.emit({ type: "turn.failed", threadId: this.threadId, error: String(error?.message ?? error) });
      this.running = false;
    });
  }

  async run() {
    const emit = (event) => { if (!this.cancelled) this.emit(event); };
    const done = () => { this.running = false; };

    // 1) 思考过程
    const reasoning = this.item("reasoning", { text: "" });
    emit({ type: "item.started", threadId: this.threadId, item: reasoning });
    for (const chunk of ["用户想看一遍模拟流程。", "我先看看目录,再申请执行一条演示命令。"]) {
      await wait(380);
      if (this.cancelled) return this.finishCancelled();
      emit({ type: "item.updated", threadId: this.threadId, itemId: reasoning.itemId, patch: { textDelta: chunk } });
    }
    emit({ type: "item.completed", threadId: this.threadId, itemId: reasoning.itemId, status: "succeeded" });

    // 2) 回复(逐字流式)
    const msg = this.item("agentMessage", { text: "" });
    emit({ type: "item.started", threadId: this.threadId, item: msg });
    const lead = "好的,演示一轮完整流程:先查看窝目录,然后我会申请执行一条演示命令,届时需要你在面板里决定。";
    for (const ch of lead) {
      await wait(26);
      if (this.cancelled) return this.finishCancelled();
      emit({ type: "item.updated", threadId: this.threadId, itemId: msg.itemId, patch: { textDelta: ch } });
    }
    emit({ type: "item.completed", threadId: this.threadId, itemId: msg.itemId, status: "succeeded" });

    // 3) 命令执行
    const cmd = this.item("commandExecution", { command: "ls -la nest", cwd: "nest", status: "inProgress" });
    emit({ type: "item.started", threadId: this.threadId, item: cmd });
    await wait(900);
    if (this.cancelled) return this.finishCancelled();
    emit({
      type: "item.updated", threadId: this.threadId, itemId: cmd.itemId,
      patch: { output: "total 1\r\n-rw-r--r--  1 you  you  0 八月 30 10:00 演示.txt", status: "succeeded" },
    });
    emit({ type: "item.completed", threadId: this.threadId, itemId: cmd.itemId, status: "succeeded" });

    // 4) 文件修改
    const file = this.item("fileChange", { path: "nest/演示.md", toolName: "Write", status: "inProgress" });
    emit({ type: "item.started", threadId: this.threadId, item: file });
    await wait(700);
    if (this.cancelled) return this.finishCancelled();
    emit({ type: "item.completed", threadId: this.threadId, itemId: file.itemId, status: "succeeded" });

    // 5) 审批:真实暂停,等面板决定(宠物此时切"被吵醒"+气泡)
    //    先注册审批、再广播:否则 publish 计算 pending 时 Map 为空,宠物收不到气泡
    const interactionId = randomUUID();
    let resolveApproval;
    const decisionPromise = new Promise((resolve) => { resolveApproval = resolve; });
    this.approvals.set(interactionId, resolveApproval);
    emit({
      type: "interaction.opened", threadId: this.threadId,
      interaction: {
        interactionId, kind: "approval", toolName: "Bash",
        summary: "$ echo 模拟审批通过 > 演示.txt",
        detail: { command: "echo 模拟审批通过 > 演示.txt", purpose: "演示审批闭环(宠物喊你 → 面板决定 → 任务继续)" },
      },
    });
    const decision = await decisionPromise;
    if (this.cancelled) return this.finishCancelled();
    emit({
      type: "interaction.closed", threadId: this.threadId, interactionId,
      resolution: decision.behavior === "allow" ? "allowed" : "denied",
    });

    // 6) 收尾
    const msg2 = this.item("agentMessage", { text: "" });
    emit({ type: "item.started", threadId: this.threadId, item: msg2 });
    const tail = decision.behavior === "allow"
      ? "已获授权,演示命令执行完毕。这就是审批闭环:宠物喊你 → 面板决定 → 任务继续。"
      : "收到拒绝,已跳过该命令。拒绝也是闭环的一部分:任务按你的意思走。";
    for (const ch of tail) {
      await wait(24);
      if (this.cancelled) return this.finishCancelled();
      emit({ type: "item.updated", threadId: this.threadId, itemId: msg2.itemId, patch: { textDelta: ch } });
    }
    emit({ type: "item.completed", threadId: this.threadId, itemId: msg2.itemId, status: "succeeded" });
    emit({ type: "thread.meta", threadId: this.threadId, meta: { model: "mock-demo", cwd: "nest" } });
    emit({
      type: "turn.completed", threadId: this.threadId,
      outcome: {
        status: "succeeded", result: "模拟任务完成",
        usage: { inputTokens: 18234, outputTokens: 542, costUsd: 0.0421 },
      },
    });
    done();
  }

  finishCancelled() {
    this.emit({ type: "turn.completed", threadId: this.threadId, outcome: { status: "cancelled", reason: "用户停止" } });
    this.running = false;
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
    this.cancelled = true;
    for (const [id, resolve] of [...this.approvals]) {
      this.approvals.delete(id);
      resolve({ behavior: "deny" });
    }
  }
}

module.exports = { MockSession };
