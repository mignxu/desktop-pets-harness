// 壳的统一契约(v1 子集)—— 所有 adapter 翻译成这里的事件,所有 UI 只认识这里。
// 参考:笔记第 6 节"适配器翻译模式";完整词汇表随功能增长。

'use strict';

// 对话(Thread)状态机 —— 宠物动作、列表状态点、气泡颜色三处同源(笔记 7.3)
const THREAD_STATES = ["idle", "working", "waitingInteraction", "error"];
const STATE_PRIORITY = { idle: 0, working: 1, error: 2, waitingInteraction: 3 };

// 聚合规则:一个工作区宠物演"最需要你注意"的那条对话
function aggregateStates(states) {
  let top = "idle";
  for (const state of states) {
    if (STATE_PRIORITY[state] > STATE_PRIORITY[top]) top = state;
  }
  return top;
}

// 契约事件(v1):
//   turn.started        { threadId }
//   turn.completed      { threadId, outcome: { status: succeeded|failed|cancelled, usage?, result? } }
//   turn.failed         { threadId, error }            // 适配器/宿主层故障(区别于 harness 报错完成的 failed)
//   item.started        { threadId, item }             // item: { itemId, type: agentMessage|reasoning|commandExecution|toolExecution|fileChange, ... }
//   item.updated        { threadId, itemId, patch }    // patch: { textDelta? , output?, status? }
//   item.completed      { threadId, itemId, status }
//   interaction.opened  { threadId, interaction: { interactionId, kind: approval, toolName, summary, detail } }
//   interaction.closed  { threadId, interactionId, resolution: allowed|denied }
//   thread.meta         { threadId, meta: { model, cwd } }

module.exports = { THREAD_STATES, STATE_PRIORITY, aggregateStates };
