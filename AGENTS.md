# AGENTS.md

## 项目:desktop-pets-harness

一个**桌面宠物形态的多 harness agent 壳**:桌面宠物作为常驻层(状态感知 + 陪伴 + 审批召唤),毛玻璃面板作为按需操作台,底层通过契约 + 适配器接入多个 agent harness(Claude Code、Codex、Pi……)。

参照系:[codex-host](https://github.com/BytePioneer-AI/codex-host) 验证了"给所有 harness 一个最好的壳"的可行性;本项目做同一件事,但壳的形态是桌面宠物。

## 接手须知(任何 agent 进入本工作区,先做这些)

1. **通读 `docs/agent-harness-shell-notes.md`** —— 它是本项目唯一的设计知识库:
   - 第 1-2 节:概念分层与执行模型(模型/Harness/壳;与用户讨论的共同语言)
   - 第 3-5 节:codex-host 源码解剖、为什么不 fork、为什么换 harness(背景论证,勿重新推导)
   - 第 6 节:自建壳的工程路线(契约先行 / 适配器翻译)
   - 第 7 节:本产品全部已定决策(信息架构 / 审批闭环 / 视觉 / 技术栈)
   - 第 8 节:最终形态愿景、不变式与演进路线
2. **不要重新讨论已锁定的决策**(速查见下);对已锁定项有异议,先读笔记里的论证再提
3. 当前阶段(2026-08-30):**v1 垂直切片完成,模拟闭环全链路验证通过**——面板(AionUi 复刻)+ 宠物窗(act_conf Player,ToDoList 渲染模型)+ 演示模式(`npm run start:mock`)已端到端跑通:流式对话、工具卡/文件卡、审批卡、宠物状态三处同源、气泡召唤聚焦、Usage 渲染(详见笔记 7.13)。**唯一挡路:中转网关凭据 403("无权访问 国产模型 分组"),真实 Claude Code 无法出网**

## 下一步(按优先级,接手后从这里开始)

1. **修凭据,跑第一条真 turn**:换可用中转 key(或 `CLAUDE_MODEL=<网关内可用模型名>`,或直连官方 API)→ `npm start` 派个小任务 → 验证真实 Claude adapter(流式/工具事件/canUseTool)。模拟已全通,真适配器走同一契约,理论上零改动
2. **真实审批闭环**:用会触发工具的任务(如"看看 nest 目录里有什么")验证 canUseTool → 审批卡 → 宠物喊你 → 面板决定
3. 之后按笔记 7.12 待定清单:Win11 补验 acrylic、多工作区(数据模型已预留)、侧栏 emoji 图标换正式图标集、`git init`(项目仍未建版本控制)

## 构建与运行

```bash
npm install          # electron 二进制若从 GitHub 下载卡死,用:
                     # ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
npm start            # 产品入口:宠物窗(小呆,右下角)+ 面板
npm run start:mock   # 演示模式:模拟 adapter 演出完整 turn(含真审批暂停),无需凭据;验证 UI/闭环用它
npm run smoke        # 冒烟:自动发一轮 turn,写 v1-smoke.json(面板隐藏)
npm run spikes       # v0 四项技术验证(写 spike-results.json)
npm run gen:frames   # 生成 spike 用的 24 帧测试素材
```

- 模型走 Claude Agent SDK:`CLAUDE_MODEL`/`ANTHROPIC_MODEL` 可覆盖;本机经中转网关,凭据问题会以 403 形式浮出到面板(这是设计行为)
- 宠物包:`PET_PACK=<目录>` 指定其他 DyberPet 格式包,默认 `小呆/`(支持一层嵌套目录);工作目录为 `nest/`(窝);滚轮缩放宠物,设置存 `pet-settings.json`
- 本机为 Win10(19045):面板为 AionUi 复刻的亮色实底(主形态);acrylic 仅 Win11 可选增强
- 渲染层报错会以 `[panel ...]` / `[pet ...]` 前缀打到主进程终端;启动日志里的 console-message deprecation 警告无害
- 目录:`src/main`(入口分发:v1-main 产品 / spike-main 验证)、`src/shared`(契约)、`src/adapter`(harness 适配:claude-code / mock)、`src/host`(线程管理与聚合)、`src/pet`(宠物窗 Player)、`src/panel`(控制台面板)、`src/spike`(v0 遗迹)、`tools/`(素材脚本)、`demo/`(预览 scratch,不进主线)、`小呆/` `像素猫meme/`(宠物素材包)

## 已锁定决策速查(论证详见笔记第 7-8 节)

- 概念:模型=思考能力;harness/agent=干活的程序;壳=交互平台
- 信息架构:宠物=工作区(一区一宠);全局宠物=无头工作区("窝"目录);面板=召唤式操作台;审批通知按对话走迷你气泡
- 铁律:对话绑定 harness 不中途换;宠物永不审批(allow/deny 只在面板);能力来自 harness 原生,壳不伪造;审批可见性永远压过其他状态
- 不做:数值养成(商店/任务/等级)
- 技术:Electron(主进程=Node,承接 harness 生态);契约先行(shared-contracts → adapters → host → UI);**面板视觉=复刻 AionUi**(亮色,token 见笔记 7.7;空态为"问候+Agent条+悬浮Composer"首页构图,会话态停靠底部;用户点名参考物后直接抄到位,勿自由发挥);宠物层=透明窗帧动画,兼容 DyberPet act_conf 格式(借格式不借代码)

## 工作规则

- **设计讨论每有新决策,当场回填笔记对应章节** —— 聊天记录不是知识库,笔记才是
- 涉及 codex-host 的源码事实,引用笔记第 3.3 节的文件索引,不要凭记忆断言
- 进入实现阶段后:在本文件追加构建/测试/lint 命令、目录结构与架构边界
