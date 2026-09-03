// 各 harness adapter 的显式能力声明(能力表)。
// 用途:面板据此做 UI 降级(例如 adapter 不支持审批 → 隐藏允许/拒绝按钮;不支持流式 → 关闭打字光标)。
// 接第二家 harness 时,只需在此追加一条能力声明,UI 无需为具体 harness 写死分支。
// 参考:笔记第 7 节已锁定决策 + 7.12 待定项的"能力表驱动 UI 降级"。
'use strict';

const ADAPTER_CAPABILITIES = {
  "claude-code": {
    id: "claude-code",
    label: "Claude Code",
    real: true, // 接真实 harness(需凭据)
    streaming: true, // 支持文本/思考增量流
    approvals: true, // 支持 canUseTool 审批闭环
    modelConfigurable: true, // 模型由 API 配置(env)注入
    nativeTools: ["Bash", "Read", "Edit", "Write", "MultiEdit", "NotebookEdit", "Glob", "Grep"],
  },
  mock: {
    id: "mock",
    label: "模拟 (Mock)",
    real: false, // 演示/联调用,不接真实 harness
    streaming: true,
    approvals: true,
    modelConfigurable: false,
    nativeTools: [],
  },
};

// 按 harnessId 取能力;mock 模式由调用方通过 mock:true 显式指定。
function getCapabilities(harnessId, { mock = false } = {}) {
  if (mock) return ADAPTER_CAPABILITIES.mock;
  return ADAPTER_CAPABILITIES[harnessId] ?? ADAPTER_CAPABILITIES["claude-code"];
}

module.exports = { ADAPTER_CAPABILITIES, getCapabilities };
