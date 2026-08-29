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
3. 当前阶段:**v1 垂直切片已实现并通过冒烟**(宠物窗 act_conf Player + Claude Code adapter + 实底控制台面板,结构与结果见笔记 7.13);本机中转网关凭据 403,待换凭据跑真 pong

## 构建与运行

```bash
npm install          # electron 二进制若从 GitHub 下载卡死,用:
                     # ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
npm start            # 产品入口:宠物窗(小呆,右下角)+ 实底控制台面板
npm run smoke        # 冒烟:自动发一轮 turn,写 v1-smoke.json(面板隐藏)
npm run spikes       # v0 四项技术验证(写 spike-results.json)
npm run gen:frames   # 生成 spike 用的 24 帧测试素材
```

- 模型走 Claude Agent SDK:`CLAUDE_MODEL`/`ANTHROPIC_MODEL` 可覆盖;本机经中转网关,凭据问题会以 403 形式浮出到面板(这是设计行为)
- 宠物包:`PET_PACK=<目录>` 指定其他 DyberPet 格式包,默认 `小呆/`;工作目录为 `nest/`(窝)
- 本机为 Win10(19045):面板是实底(主形态);acrylic 仅 Win11 可选增强
- 目录:`src/main`(入口分发:v1-main 产品 / spike-main 验证)、`src/shared`(契约)、`src/adapter`(harness 适配)、`src/host`(线程管理与聚合)、`src/pet`(宠物窗 Player)、`src/panel`(控制台面板)、`src/spike`(v0 遗迹)、`tools/`(素材脚本)、`demo/`(预览 scratch,不进主线)、`小呆/`(宠物素材包)

## 已锁定决策速查(论证详见笔记第 7-8 节)

- 概念:模型=思考能力;harness/agent=干活的程序;壳=交互平台
- 信息架构:宠物=工作区(一区一宠);全局宠物=无头工作区("窝"目录);面板=召唤式操作台;审批通知按对话走迷你气泡
- 铁律:对话绑定 harness 不中途换;宠物永不审批(allow/deny 只在面板);能力来自 harness 原生,壳不伪造;审批可见性永远压过其他状态
- 不做:数值养成(商店/任务/等级)
- 技术:Electron(主进程=Node,承接 harness 生态);契约先行(shared-contracts → adapters → host → UI);**面板=实底控制台,视觉模仿 Codex Desktop**(毛玻璃仅为 Win11 可选增强,默认实底,增强不承载信息);宠物层=透明窗帧动画,兼容 DyberPet act_conf 格式(借格式不借代码)

## 工作规则

- **设计讨论每有新决策,当场回填笔记对应章节** —— 聊天记录不是知识库,笔记才是
- 涉及 codex-host 的源码事实,引用笔记第 3.3 节的文件索引,不要凭记忆断言
- 进入实现阶段后:在本文件追加构建/测试/lint 命令、目录结构与架构边界
