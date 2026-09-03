// 审批闭环无头集成测试(C1 的免 GUI 验证)。
// 用 MockSession(approvals:true)驱动完整 turn,断言契约事件流 + 状态机 + 宠物待审批广播 + 面板能力表。
// 运行: node scripts/test-approval-loop.cjs   (无需凭据 / 无需 Electron GUI)
'use strict';

// 关键:选用 mock adapter(在 require thread-manager 之前设置)
process.env.MOCK_TURN = '1';

const { ThreadManager } = require('../src/host/thread-manager.js');

// 捕获契约校验报错(handleEvent 内以 console.error('[contract] ...') 非致命报告)
let contractErrors = 0;
const origErr = console.error;
console.error = (...args) => {
  const msg = args.map((a) => String(a)).join(' ');
  if (msg.includes('[contract]')) contractErrors += 1;
  else origErr(...args);
};

const received = { events: [], petStates: [], snapshotDirty: 0 };
const broadcast = (channel, payload) => {
  if (channel === 'contract:event' && payload && payload.type) received.events.push(payload);
  if (channel === 'pet:state') received.petStates.push(payload);
  if (channel === 'panel:snapshot-dirty') received.snapshotDirty += 1;
};

const manager = new ThreadManager({ broadcast });

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label);
  }
}

const waitFor = (pred, timeoutMs = 9000) =>
  new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      let ok = false;
      try { ok = pred(); } catch { /* ignore */ }
      if (ok) { clearInterval(iv); resolve(true); }
      else if (Date.now() - start > timeoutMs) { clearInterval(iv); reject(new Error('waitFor timeout')); }
    }, 20);
  });

(async () => {
  console.log('== C1 审批闭环 无头集成测试 ==');

  const thread = manager.createThread({ cwd: 'nest', model: 'mock', title: 'approval-test' });
  const threadId = thread.threadId;

  manager.startTurn(threadId, '演示:走一遍完整流程(含审批)');

  // 1) 等到审批打开
  await waitFor(() => received.events.some((e) => e.type === 'interaction.opened'));
  const opened = received.events.find((e) => e.type === 'interaction.opened');

  assert(opened && typeof opened.interaction.interactionId === 'string',
    'interaction.opened 携带 interactionId');
  assert(opened.interaction.kind === 'approval' && opened.interaction.toolName === 'Bash',
    'interaction.opened 为 Bash 审批');
  assert(manager.get(threadId).state === 'waitingInteraction',
    'thread.state === waitingInteraction(审批暂停态)');
  // 注:Thread 对象本身不存 pending 字段,pending 由 snapshot() 经 collectPendingInteractions 计算
  const snapNow = manager.snapshot().threads.find((t) => t.threadId === threadId);
  assert(snapNow && snapNow.pending >= 1,
    'snapshot.threads[].pending >= 1(待审批清单已聚合)');

  const lastPet = received.petStates[received.petStates.length - 1];
  assert(lastPet && lastPet.state === 'waitingInteraction',
    'pet:state 广播携带 waitingInteraction(宠物切"被吵醒")');
  assert(lastPet && Array.isArray(lastPet.pending) && lastPet.pending.length === 1,
    'pet:state.pending 恰好 1 条(气泡召唤)');
  assert(lastPet.pending[0].threadId === threadId && lastPet.pending[0].toolName === 'Bash',
    'pending 含正确 threadId 与 toolName');

  // 2) 能力表:面板据此渲染 allow/deny 按钮
  const snap = manager.snapshot();
  assert(snap.capabilities && snap.capabilities.id === 'mock' && snap.capabilities.approvals === true,
    'snapshot.capabilities.approvals === true(按钮可见)');

  // 3) 面板点"允许" → 经 IPC interaction:respond → manager.respond
  const ok = manager.respond(threadId, opened.interaction.interactionId, 'allow');
  assert(ok === true, 'manager.respond(allow) 返回 true');

  // 4) 等 turn 收尾
  await waitFor(() => received.events.some((e) => e.type === 'turn.completed'));

  const closed = received.events.find((e) => e.type === 'interaction.closed');
  assert(closed && closed.interactionId === opened.interaction.interactionId,
    'interaction.closed 与 opened 同 interactionId');
  assert(closed && closed.resolution === 'allowed',
    'interaction.closed.resolution === allowed');

  const completed = received.events.find((e) => e.type === 'turn.completed');
  assert(completed && completed.outcome.status === 'succeeded',
    'turn.completed.outcome.status === succeeded');
  assert(manager.get(threadId).state === 'idle',
    'turn 结束后 thread.state === idle');

  // 5) 全程契约零误报
  assert(contractErrors === 0,
    '全链路契约校验零误报 (contractErrors=' + contractErrors + ')');

  // 6) 事件顺序健全性:turn.started 在 interaction.opened 前,interaction.closed 在其后
  const seq = received.events.map((e) => e.type);
  const iStart = seq.indexOf('turn.started');
  const iOpen = seq.indexOf('interaction.opened');
  const iClose = seq.indexOf('interaction.closed');
  const iDone = seq.indexOf('turn.completed');
  assert(iStart < iOpen && iOpen < iClose && iClose < iDone,
    '事件时序: turn.started < interaction.opened < interaction.closed < turn.completed');

  console.log('');
  if (failures === 0) {
    console.log('ALL CHECKS PASSED — 审批闭环(契约/状态机/宠物待审批广播/能力表)已无头验证通过。');
    console.log('剩余待你本机实测: 真实 GUI + 真 canUseTool(需凭据)。');
    process.exit(0);
  } else {
    console.log(failures + ' 项断言失败。');
    process.exit(1);
  }
})().catch((e) => {
  console.error('TEST ERROR:', e && e.message);
  process.exit(1);
});
