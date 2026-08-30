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
3. 当前阶段(2026-08-30 晚):**v1 全功能完成 + 面板已迁移 React18+Arco**——真 turn(minimax-m2.5 @ 用户 new-api)跑通、markdown/diff/持久化/审批闭环(模拟+真实 canUseTool 两次实操)全通过;**打包(electron-builder)配置就绪但卡在网络下载**:winCodeSign 资源 600s 超时,exe 改写跳过后又遇静默退出(127),待下会话继续(见下一步 1)

## 下一步(按优先级,接手后从这里开始)

1. **打包收尾(网络卡点,已定位一半)**:配置全在 `electron-builder.yml`(参考 ToDoList 同款:extraResources 宠物包/nsis+portable/图标脚本 `npm run icon`);`npx electron-builder --win --dir -c.win.signAndEditExecutable=false` 重跑(强杀残留的锁已清),若 winCodeSign 依旧超时 → 从 npmmirror 手动预填 `%LOCALAPPDATA%\electron-builder\Cache`,或挂代理;ToDoList 在同机打包成功过,可对照其构建环境
2. **真实审批闭环再实测一轮**(React 面板下):发"看看 nest 目录里有什么"→ canUseTool 审批卡 + 宠物被吵醒 + 气泡召唤 → 面板决定
3. **契约固化**:用真 turn 事件形状校验后,固化为 zod schema + 每 adapter 显式 capabilities(能力表驱动 UI 降级)——放在接第二家 harness 之前
4. 之后按笔记 7.12:第二家 harness(ACP 兜底 vs 原生)、Win11 补验 acrylic、多工作区、图标换正式图标集、会话重命名/删除

## 构建与运行

```bash
npm install          # electron 二进制若从 GitHub 下载卡死,用:
                     # ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
npm start            # 产品入口:宠物窗(小呆,右下角)+ 面板
npm run start:mock   # 演示模式:模拟 adapter 演出完整 turn(含真审批暂停),无需凭据;验证 UI/闭环用它
npm run panel:build  # 面板渲染层构建(改 src/panel-app 后必须执行,Electron 加载 build/panel)
npm run smoke        # 冒烟:自动发一轮 turn,写 v1-smoke.json(面板隐藏)
npm run spikes       # v0 四项技术验证(写 spike-results.json)
npm run gen:frames   # 生成 spike 用的 24 帧测试素材
```

- 模型走 Claude Agent SDK:`CLAUDE_MODEL`/`ANTHROPIC_MODEL` 可覆盖;本机经中转网关,凭据问题会以 403 形式浮出到面板(这是设计行为)
- 宠物包:`PET_PACK=<目录>` 指定其他 DyberPet 格式包,默认 `小呆/`(支持一层嵌套目录);工作目录为 `nest/`(窝);滚轮缩放宠物,设置存 `pet-settings.json`
- 本机为 Win10(19045):面板为 AionUi 复刻的亮色实底(主形态);acrylic 仅 Win11 可选增强
- 渲染层报错会以 `[panel ...]` / `[pet ...]` 前缀打到主进程终端;启动日志里的 console-message deprecation 警告无害
- 目录:`src/main`(入口分发:v1-main 产品 / spike-main 验证)、`src/shared`(契约)、`src/adapter`(harness 适配:claude-code / mock)、`src/host`(线程管理与聚合)、`src/pet`(宠物窗 Player)、`src/panel`(preload)、`src/panel-app`(面板 React 源码,构建到 `build/panel`)、`src/spike`(v0 遗迹)、`tools/`(素材脚本)、`demo/`(预览 scratch,不进主线)、`小呆/` `像素猫meme/`(宠物素材包)

## 已锁定决策速查(论证详见笔记第 7-8 节)

- 概念:模型=思考能力;harness/agent=干活的程序;壳=交互平台
- 信息架构:宠物=工作区(一区一宠);全局宠物=无头工作区("窝"目录);面板=召唤式操作台;审批通知按对话走迷你气泡
- 铁律:对话绑定 harness 不中途换;宠物永不审批(allow/deny 只在面板);能力来自 harness 原生,壳不伪造;审批可见性永远压过其他状态
- 不做:数值养成(商店/任务/等级)
- 技术:Electron(主进程=Node,承接 harness 生态);契约先行(shared-contracts → adapters → host → UI);**面板视觉=复刻 AionUi**(亮色;token 见笔记 7.7;空态为"问候+Agent条+悬浮Composer"首页构图,会话态停靠底部;用户点名参考物后直接抄到位,勿自由发挥);**面板渲染层=React18 + Arco**(AionUi 同栈;源码 `src/panel-app`,改面板后必须 `npm run panel:build`,Electron 加载 `build/panel`);宠物层=透明窗帧动画,兼容 DyberPet act_conf 格式(借格式不借代码)

## 工作规则

- **设计讨论每有新决策,当场回填笔记对应章节** —— 聊天记录不是知识库,笔记才是
- 涉及 codex-host 的源码事实,引用笔记第 3.3 节的文件索引,不要凭记忆断言
- 进入实现阶段后:在本文件追加构建/测试/lint 命令、目录结构与架构边界
