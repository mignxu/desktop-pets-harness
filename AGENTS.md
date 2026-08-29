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
3. 当前阶段:**v0 技术 spike 已全部通过**(Electron 44,四项结果见笔记 7.10);`demo/` 下另有 DyberPet act_conf 播放器网页 demo(双击 `demo/xiaodai.html` 即跑);下一步 v1 垂直切片

## 构建与运行(v0)

```bash
npm install          # electron 二进制若从 GitHub 下载卡死,用:
                     # ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
npm run gen:frames   # 生成 24 帧测试素材(src/pet/frames)
npm start            # 手动模式:宠物窗(右下角)+ 面板窗,肉眼检查
npm run spikes       # 自测模式:跑四个 spike,写 spike-results.json 后自动退出
```

- Spike C(Claude SDK)只在 `npm run spikes` 或 `SPIKE_RUN_SDK=1 npm start` 时运行
- 本机为 Win10(19045):毛玻璃走降级链是**预期行为**;acrylic 需 Win11 验证
- 目录:`src/main`(Electron 主进程+spike 装配)、`src/pet`(宠物窗:帧动画/点击穿透)、`src/panel`(玻璃面板)、`tools/gen-frames.mjs`(素材生成)、`demo/`(效果预览 scratch,**不进主线**)、`pets/`、`小呆/`、`像素猫meme/`(素材包,仅参考)

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
