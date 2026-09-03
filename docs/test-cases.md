# 测试用例 / Test Cases — DesktopPetShell

> 整理日期：2026-09-03
> 关联：产品定位见 `docs/product-overview.html`；架构见 `AGENTS.md` 与 `docs/agent-harness-shell-notes.md`
> 已落地自动化：C1 审批闭环无头集成测试（`scripts/test-approval-loop.cjs`，运行 `npm run test:approval` 或 `node scripts/test-approval-loop.cjs`）

---

## 0. 测试金字塔与范围

| 层 | 类型 | 现状 | 说明 |
|----|------|------|------|
| 契约层 | 结构校验 | ✅ 已自动化（C2） | zod schema + `validateContractEvent`，112 条真实事件回归 0 误杀 |
| 适配层 | 集成测试 | 🟡 C1 已自动化，其余待建 | MockSession 驱动；真 adapter 待 C3 |
| 伴侣层 | UI/交互 | ⚪ 需手工 + 截图 | 宠物状态/气泡/面板渲染 |
| 统一层 | 端到端 | ⚪ 依赖 C3 | 多 harness 切换不换窗 |

---

## 1. 已自动化用例

### TC-C1-01 · 审批闭环无头集成测试
- **文件**：`scripts/test-approval-loop.cjs`
- **驱动**：MockSession（`approvals: true`）演出完整 turn
- **断言（15 项全 PASS）**：
  1. `interaction.opened` 携带 `interactionId`，`kind=approval`、`toolName=Bash`
  2. 审批打开时 `thread.state === waitingInteraction`
  3. `snapshot.threads[].pending >= 1`
  4. `pet:state` 广播携带 `waitingInteraction` + `pending` 恰 1 条（宠物被吵醒 + 气泡）
  5. `pending` 含正确 `threadId` / `toolName`
  6. `snapshot.capabilities.approvals === true`（按钮可见）
  7. `manager.respond(allow)` 返回 `true`
  8. `interaction.closed.interactionId` 与 opened 同
  9. `interaction.closed.resolution === allowed`
  10. `turn.completed.outcome.status === succeeded`
  11. turn 结束后 `thread.state === idle`
  12. **全链路契约校验零误报**（回证 C2 schema 贴合真实形状）
  13. 事件时序 `turn.started < interaction.opened < interaction.closed < turn.completed`

---

## 2. Persona A（多 harness 统一派）场景

> 前提：需要 ≥2 个真 adapter（claude-code + codex，即 C3 完成）

| ID | 用例 | 步骤 | 期望 |
|----|------|------|------|
| TC-A-01 | 创建多 harness 会话并切换不换窗 | 建 Claude 会话 → 建 Codex 会话 → 切换 activeThread | 面板内切换，无新窗口；宠物常驻不重建 |
| TC-A-02 | 跨 harness 复用同一 MCP server | 注册一个 MCP server → 分别绑到两个 thread 的 harness | server 一次编写，两端均可用；client 接线差异由壳封装 |
| TC-A-03 | 能力表驱动 UI 降级 | Codex 声明 `approvals:false` | 面板对该 thread 隐藏 allow/deny 按钮，不报错 |
| TC-A-04 | 会话持久化跨重启 | 跑一轮含审批的 turn → 退出 → 重启加载 `store/conversations.json` | 日志完整重放，状态归位 idle，审批不续跑 |
| TC-A-05 | 对话绑定 harness 不中途换 | 某 thread 用 Claude，期间误触发切换 | 铁律：不换 harness；若有切换入口须明确为“新 thread” |

---

## 3. Persona B（单 harness 宠物派）场景

> 前提：Codex adapter 存在（C3）；用户保留心爱 harness 的引擎/账号

| ID | 用例 | 步骤 | 期望 |
|----|------|------|------|
| TC-B-01 | 单 harness 启动即有伴侣层 | 用壳启动 Codex（非 Codex Desktop） | 宠物常驻右下角 + 面板操作台；Codex 引擎/账号不变 |
| TC-B-02 | 审批经宠物气泡召唤 + 面板决定 | 触发一次 canUseTool | 宠物切“被吵醒”+气泡；点气泡→面板聚焦→allow/deny→任务继续 |
| TC-B-03 | 保留原 harness 体验 | 检查模型选择/工具行为 | 与直接用 Codex 一致（壳不伪造能力） |
| TC-B-04 | 只换模型不换 harness | 在 Codex 内切 DeepSeek/GLM/GPT | 壳仅显示 `model` 字段，不介入；无需切换 harness |

---

## 4. 契约 / 健壮性

| ID | 用例 | 步骤 | 期望 |
|----|------|------|------|
| TC-X-01 | 契约校验非致命 | 注入一条字段缺失/类型错的事件 | `handleEvent` 仅 `console.error` 告警，不阻断事件流；误报率 0 |
| TC-X-02 | 未知 harness 降级 | `getCapabilities("unknown")` | 回退默认（claude-code）能力，UI 不崩 |
| TC-X-03 | adapter 翻译回归 | 真 turn 事件跑 `validateContractEvent` | 真实事件 0 误杀（已用 112 条验证，需纳入 CI） |
| TC-X-04 | 宠物待审批广播正确性 | approval 注册**后**才 emit `interaction.opened` | `pet:state.pending` 为 1（MockSession 已保证顺序） |

---

## 5. 待建（依赖 C3 Codex adapter）

以下用例目前被 C3 阻塞，建议 C3 完成后补齐自动化：

- TC-A-01 ~ TC-A-05：需 codex adapter
- TC-B-01 ~ TC-B-04：需 codex adapter
- 新增 `scripts/test-multiharness.cjs`：双 adapter 并存 + 切换不换窗 的集成测试

---

## 6. 运行方式

```bash
# 已自动化：审批闭环
npm run test:approval
# 或等价
node scripts/test-approval-loop.cjs
```

> 注：测试脚本已在 `electron-builder.yml` 中以 `!scripts/test-approval-loop.cjs` 排除出安装包。
