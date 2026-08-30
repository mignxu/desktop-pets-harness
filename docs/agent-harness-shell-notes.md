# Agent / Harness / 壳 —— 架构学习笔记

> 整理自 2026-08-29 与 ZCode 的讨论。
> 核心案例:[BytePioneer-AI/codex-host](https://github.com/BytePioneer-AI/codex-host)(MIT,547 stars)。
> 目的:理解"多 Agent 桌面壳"这一类产品的概念分层与工程架构,为自研壳做准备。

---

## 0. 一句话总览

**模型只动嘴,harness 动手,壳负责让你舒服地看和指挥。**
CodexHost = 给最好的壳(Codex Desktop)做一个"转接头",让它能认别家的 harness,且不削功能。

---

## 1. 四层概念模型

```text
┌─ 壳 / UI 层:   Codex Desktop、各家 TUI 终端界面、IDE 插件
├─ Harness 层:   Codex CLI、Claude Code、Pi、OMP、Grok CLI、DeepSeek Harness
├─ Provider 层:  OpenAI API、Anthropic API、DeepSeek API……
└─ Model 层:     GPT、Claude、Grok、DeepSeek、GLM……
```

| 概念 | 是什么 | 记忆点 |
| --- | --- | --- |
| **Model 模型** | 只会"读文字→吐文字"的思考能力 | 没手没眼没记忆,什么都干不了 |
| **Provider** | 承载模型的接口与计费后端 | 不等于模型本身,也不等于账号 |
| **Harness** | 干活的程序:Agent Loop + 工具系统 + 权限交互 + 会话状态 | "Agent"是它在 UI 里的口头叫法 |
| **壳(Shell)** | 承载 harness+模型行为、与用户交互的界面平台 | Codex Desktop、TUI 都是壳 |

术语出处:codex-host 仓库 `docs/领域术语表.md` ——
"Agent: Harness 在用户界面中的名称";"Harness: 拥有 Agent Loop、上下文组织、工具系统、权限交互和原生会话状态的执行主体"。

**六列能力表里的全是 harness**(Codex / Pi / OMP / Claude Code / Grok / DeepSeek),
Codex Desktop 本身不是 harness,是壳。注意:公司既造模型也造 harness(Claude Code≠Claude),
且一个 Thread 固定一个 harness,但 Model 可在不同 Turn 间切换。

---

## 2. 按下回车后到底发生了什么(理解一切的地基)

```text
你: "帮我修这个 bug" ↓回车

① Claude Code(harness 程序)收到你的话
② 它把 你的话+系统提示词+历史记录 打包,发给 Claude(模型)
③ 模型吐回一段文字:"我先跑一下测试看看报错"
④ Claude Code 看到要跑测试 → 它自己去执行 npm test
⑤ 它把测试报错再发给模型
⑥ 模型:"把第 10 行改成 xxx"
⑦ Claude Code 真的去改文件,算出 diff,弹窗问"允许吗?"
⑧ 你点允许,它改完,再把结果发给模型……循环,直到修完
```

**模型在 ③⑥ 只负责动嘴;④⑦ 动手的全是 harness。**
换模型 = 只换"动嘴的";换 harness = 换整套"动手的"习惯。

---

## 3. CodexHost 项目解析

### 3.1 它是什么、解决什么

**在官方 Codex Desktop 里运行 Pi、Claude Code、OMP、Grok Build、DeepSeek Harness**,
保留原生 UI(流式、Diff、审批、提问、Fork、Usage)。`npm install -g @codexhost/cli`。

- 不走 ACP 路线(ACP 会把审批/权限/Diff 削平成公共分母)
- 口号:"目标是保真,不只『能聊』"——能力来自 harness 本身,不伪造
- 表中 "—" = harness 自己没有该能力,壳不削功能,也不凭空造功能

### 3.2 核心原理:三个透明拦截点

```text
Launcher(Rust)
  ├─ 环境变量劫持:CODEX_CLI_PATH → 指向 shim(假 codex CLI)
  ├─ 给 Electron 加 --inspect=127.0.0.1:<port>(开 CDP 通道)
  └─ 拉起 Desktop Controller(Node,负责注入)
        │
        ▼
Codex Desktop(官方,未改一字节)
  ├─ 想跑 codex CLI → 实际跑的是 shim
  │     ├─ 普通命令:字节透传给真 codex(终端用法完全不受影响)
  │     └─ codex app-server:替换成 Host Runtime(Node)
  ├─ 渲染层被 CDP 注入扩展:加 Agent/Model 选择器、Usage 面板等
  └─ (从 Desktop 视角)对面就是一个标准 app-server
```

**1)进程劫持** —— `crates/shim`(Rust)
Desktop 通过 `CODEX_CLI_PATH` 找 CLI → 实际是 shim。仅在 `app-server` 启动时换成 Host Runtime,其余全部 16KB 缓冲字节透传 + 信号转发。

**2)协议劫持** —— `packages/host-runtime` + `packages/protocol-core`(核心)
Host Runtime 冒充 app-server(LF 分帧 JSON-RPC 2.0 over stdio),内部把真 app-server 当子进程,双向泵数据、按请求分流:
- `thread/start` 的 `model` 字段若为 `codexhost/claude-code-native@<model>@<权限>@<thinking>` 这样的**传输模型 ID** → 路由到对应 harness adapter(巧妙:官方协议自带 model 字符串参数,协议零修改,字段变路由载体)
- 官方线程原样字节转发;外部线程由 adapter 驱动;`thread/list` 聚合两边的会话
- harness 事件 → `codex-ui-projector` 投影成 Codex 通知(`turn/started`、`item/started`、`item/completed`…),条目映射:agentMessage/reasoning/commandExecution/dynamicToolCall/fileChange(带 unified diff)/subagentDelegation
- 审批和提问是**反向服务端请求**:Host 用保留负数 ID 段(-2000000..-1000001 审批,-1000000..-1 提问)发给 Desktop,复用官方原生审批卡片/提问弹窗机制
- `packages/mapping-store` 持久化 Host Thread ID ↔ Native Session/Checkpoint(支撑 Fork/回滚/历史重读)

**3)渲染劫持** —— `packages/desktop-control` + `packages/renderer-extension`
CDP 连 Electron Inspector(`/json/list` → WebSocket → `Runtime.evaluate` 注入 bundle);扩展走 **React Fiber**(`__reactFiber$` 属性逐层向上找)定位 Composer 内部状态,写入传输模型 ID;复用渲染层自己的 JSON-RPC request manager 发 `codexhost/*` 自定义方法。

### 3.3 关键源码索引(回头精读用)

| 文件 | 作用 |
| --- | --- |
| `crates/shim/src/lib.rs` | 透明代理 + app-server 替换判断 |
| `packages/host-runtime/src/app-server-host.ts` | 请求分流核心(`#forwardDesktop` 路由) |
| `packages/protocol-core/src/model-routing.ts` | 传输模型 ID 编解码(路由载体) |
| `packages/protocol-core/src/codex-ui-projector.ts` | harness 事件 → Codex 协议投影 |
| `packages/harness-adapter/src/text-session.ts` | 统一 adapter 契约(HostEvent/HostItem/交互) |
| `packages/adapters/claude-code/src/sdk-transport.ts` | Claude 官方 Agent SDK 接入样例 |
| `packages/desktop-control/src/renderer-control-session.ts` | CDP 注入流程 |
| `packages/renderer-extension/src/versioned-renderer-adapter.ts` | React Fiber 适配(版本锁定) |
| `docs/领域术语表.md` | 概念定义权威出处 |
| `docs/codex-desktop-26.814-compatibility-debt.md` | 版本兼容债实例(注入方案的成本) |

---

## 4. 为什么不 fork Codex Desktop

**前提:Codex Desktop 不开源。**开源的是 openai/codex 仓库的 CLI + app-server 协议;桌面壳闭源:
- [issue #10733](https://github.com/openai/codex/issues/10733):"We don't have any plans to open source the app at this time."
- [discussion #16538](https://github.com/openai/codex/discussions/16538):"If you want to write your own client, you're welcome to do so."(官方欢迎第三方客户端,app-server 就是公开接口)

即使假想开源,fork 仍然更差:
1. **上游节奏**:官方一更新,内部函数重写就导致兼容代码失效(见 26.814 兼容债文档)。注入方案=修兼容层+兜底回退官方壳;fork=每次 rebase 大补丁。
2. **分发/签名/更新**:fork 要自己分发三平台 Electron 二进制、自己签名公证、断官方自动更新;注入方案只发一个小 npm 包,用户继续用官方自动更新、字节未改的 app,账号凭据在官方代码里跑,信任面小。
3. **护城河不在 UI**:真正的工程量在 Host Runtime 与 adapters,和壳源码无关。

---

## 5. 为什么切 harness,而不是只在 Codex 里换模型

换模型只换"动嘴的"。harness 决定:

1. **Agent Loop 与提示词体系**——各家为自家模型深度调校,跨家错配会明显掉档;同模型不同 harness 的体感差异常大于同 harness 换模型
2. **工具系统设计**——apply_patch vs Edit 工具,diff 可靠率、沙箱策略
3. **交互与工作流**——权限模式、Plan Mode、hooks、子代理、斜杠命令、MCP 生态(互不可替代,对应能力表各行)
4. **会话格式**——Fork/回滚/压缩的语义每家不同
5. **订阅绑定在 harness 上**(最现实)——Claude Max 额度只能经 Claude Code 用,ChatGPT 订阅的 Codex 额度只能经 Codex 用;"在 Codex 里接 Claude"只能走 API 计费

> 比方:模型=发动机,harness=整台车(变速箱/底盘/转向),壳=驾驶舱仪表盘。
> 好发动机装进错配的车架开不出最佳效果;换 harness 经常是在换"用哪份额度"。

---

## 6. 自建壳的路线(给未来的自己)

### 6.1 三条接入路线(按成本从低到高)

| 路线 | 接入对象 | 成本 | 保真度 |
| --- | --- | --- | --- |
| **ACP**(Agent Client Protocol,Zed 提出) | 多 harness 一把梭(Claude Code 官方适配器等) | 最低 | 削平到公共分母,特有能力丢失 |
| **官方 app-server 协议** | 仅 Codex 系 | 中 | 高(`codex app-server generate-json-schema` 可导出协议 Schema) |
| **原生 per-harness 接入** | Claude Agent SDK / Pi RPC / 各家 CLI | 最高 | 满(即 codexhost 路线) |

参考先例:[Paseo](https://github.com/getpaseo/paseo)(自建壳+多 harness,亦是 codexhost 的灵感来源)。
捷径:fork codexhost 的 host-runtime(MIT)当后端,自己只做前端壳——免费拿走全部路由与适配工程。

### 6.2 顺序:先契约,后能力表

**第一件事不是画能力矩阵,是定义壳"听得懂的语言"(统一契约)**。
表里每一格 = "契约里的一个词" × "某个 harness 会不会说这个词"。先有词汇表,才有能力表。

- codexhost 印证:`shared-contracts`(定词)→ 每个 adapter 的 `inspect()`/`capabilities` 运行时自报"我会什么" → README 表只是人读投影,顺手当营销
- 实操:①挑一个 harness(建议 Claude Code,有官方 SDK)跑通最小闭环"输入→流式回复";②每加功能,契约加一个词;③每接新 harness,填一次表;④每个"—"必须变成 UI 降级(藏按钮/降级为纯文本),不许崩、不许装

### 6.3 适配器翻译模式

壳只说契约语言;每个 harness 配一个"翻译"(adapter):

```text
Pi 原生事件 ──────┐
Claude SDK 回调 ──┤  各自 adapter 翻译 → 壳的契约词(统一) → 你的 UI
Codex 协议通知 ───┘
```

翻译的三种不整齐情况(真实工作量所在):
- **一对多**:一个原生工具事件拆成"工具开始+输出追加+工具完成"三条
- **多对一**:各家不同的编辑方式归到同一个"文件修改"词
- **没有对应词**:双向缺失都标"—",UI 降级

adapter 写得好不好,看翻译丢不丢味道——这就是"保真"的工程含义。
(codexhost 做了两次翻译:harness 原生 → shared-contracts(adapter 里),再 → Codex Desktop 协议(codex-ui-projector);自建壳只需一次。)

---

## 7. 产品形态:桌面宠物壳(讨论中,持续回填)

### 7.1 定位

**桌面宠物形态的多 harness agent 壳。**差异化:服务"把 agent 派出去干活的人"(Codex Desktop 服务"盯着 agent 干活的人")。宠物 = 陪伴 + 状态感知,让 vibe coding 不无聊;多 harness 聚合是核心动机。

### 7.2 信息架构

```text
产品
├── 🐾 全局宠物(常驻 = 无头工作区,兼任产品入口/设置)
│     └── 对话若干(不挂项目,跑在默认"窝"目录)
├── 🐱 工作区宠物 A(= 项目 A)   ← 一工作区一宠,多工作区多宠
│     ├── 对话 1(Claude Code)   ← 对话绑定 harness,铁律不可中途换
│     └── 对话 2(Codex)         ← 换 harness = 同区开新对话
└── 面板:宠物召唤出来,工作区级操作台
```

- 换 harness 禁止中途切:有背书(codex-host 术语表把"跨 Harness 迁移"列入 Avoid,fork 都强制继承原 harness)
- 开机动画:宠物逐只跳出 = 工作区加载反馈
- 工作区是纯壳层概念,adapter 零配合,thread 挂 workspace_id

### 7.3 宠物状态语义

- 宠物身体演**最高优先级**状态:`审批/提问 > 出错 > 干活中 > 空闲`(审批必须永远赢)
- **审批通知按对话走迷你气泡**:一条对话一个泡(对话名+内容摘要+【我去处理】),点哪个跳哪条;多条同时弹多个泡;气泡堆叠机制参考 DyberPet `bubbleManager.py`
- 悬停宠物 = 快速预览该工作区全部对话状态
- 状态光:宠物脚下光环颜色 = 状态(绿/琥珀/红),科技感与功能合一

### 7.4 cwd 与权限(照抄 Codex Desktop 语义)

- 官方 Codex `thread/start` 的 cwd 可选(默认目录);**外部 harness 强制要 cwd**(codex-host `app-server-host.ts:1711` 直接报错)
- 项目工作区绑项目文件夹;全局工作区 = 默认"窝"目录(scratch)
- 窝目录误伤面大 → 权限默认档比项目区严一档

### 7.5 审批闭环(安全命门)

```text
审批请求 → 宠物拽袖子(身体状态)+ 迷你气泡(通知)
  → 点【我去处理】→ 跳转面板,聚焦该对话的审批卡片,高亮
  → 多条待审批排队;过期前宠物二次催促(expiresAt),过期后按 harness 策略
```

- **宠物永不审批**;迷你气泡上不放"拒绝"按钮(看不到内容不能拒绝),allow/deny 都只在面板
- 无头工作区权限默认更严
- **实机调试修出的三个坑(2026-08-29)**:
  1. `publish` 组装气泡数据时解构错误(`{thread, interaction}` 里解 `threadId`)→ 气泡【我去处理】传 undefined → 面板跳空白首页。已修
  2. adapter"先广播 interaction.opened、后注册 approvals"→ publish 算 pending 时为空 → 宠物永远收不到气泡(ClaudeCodeSession 同犯,一起修)。**时序铁律:先注册审批,再广播**
  3. 气泡定位:帧图常有大量透明留白,按帧顶定位会"离头太远"——采用 ToDoList frameTops 方案:渲染层扫描当前帧 alpha 通道量出头顶边距(按 src 缓存),气泡 bottom 锚到可见头顶;宠物窗需 `webSecurity:false` 才能读 canvas 像素(只加载本地内容,可接受)。等待审批期间**循环播放"被吵醒"动画**直至处理完(用户要求)
  4. **IPC snapshot 是结构化克隆的"当时副本",不是活引用**——面板 init 拿到的 log 数组不会随主进程事件增长,事件只靠推送做增量渲染;因此**任何全量重画(召唤聚焦/切换对话)前必须重新拉快照**,否则渲染出陈旧数据(表现为"召唤后跳到空白对话")。气泡样式已按用户要求复刻 ToDoList 原版(白底胶囊 + `#e8907e` 珊瑚描边 + 小尾巴)

### 7.6 去养成(明确决策)

不做商店/任务/等级。宠物保留"活物感"(对用户存在的小反应,patpat 类)——陪伴感来自无功能细节。

### 7.7 视觉方向(2026-08-29 第三次修订:面板直接复刻 AionUi)

- **面板视觉 = 复刻 [AionUi](https://github.com/iOfficeAI/AionUi)(用户指定"开抄")**,token 取自其源码 `styles/themes/default-color-scheme.css`(Arco 体系亮色):主色 `#165dff`、成功 `#00b42a`、警告 `#ff7d00`、危险 `#f53f3f`、用户消息底 `#e9efff`、Agent 选择条 `#eaecf7`、品牌紫发送钮 `#7583b2`、文字 `#000/#454d5f/#86909c`、边框 `#e5e6eb/#f2f3f5`
- **首页构图(空态)**:居中大字问候 → Agent 选择条(圆角胶囊条+白色 harness 胶囊+"+")→ 大圆角白 Composer 卡(model/权限胶囊 + 圆形发送钮)→ 下方 "📁 窝 ⌄"(对应它的 "Work in a project");`body.has-messages` 类切换 首页构图 ↔ 会话构图(composer 停靠底部)
- 侧栏:白底,黑圆角方块 Logo + 粗体名,黑圆片 "+" 导航,分组纯文字列表,底部 Usage 小字
- **侧栏 = AionUi Sider 完整结构**(源码级:SiderToolbar/SiderNav/GroupedHistory/SiderFooter):工具栏行(22px `rd-6px` + 芯片"新对话" + 批量管理图标)→ 助手/定时任务导航行(逻辑后加)→ 1px 分隔 → 滚动区(分组标签 28px/14px/三级灰 → **工作区组(📁 窝,可嵌套对话行)** → 对话组)→ Footer(Usage 小字 + 主题/设置)。对话行:22px 黑圆 harness 头像 + 14px/500 名称 + 生成中蓝点 `#2c7fff`(光晕)/琥珀待审批角标
- **多对话已接线**:`thread:create` → 新空会话切首页构图;发送按 activeThreadId 路由;harness 图标挂对话行(铁律可视化)
- 演进记录:暗色 Codex 式(半天,被否)→ ChatGPT Desktop 亮色(一天,被否「依旧很丑」)→ AionUi 首页皮(被否:「除了聊天哪里复刻了」)→ **AionUi 完整 UX(现行)**。教训固化:**用户点名参考物后,完整复刻其结构与 UX(含侧栏信息架构),不要只抄视觉皮;我们的精力放在加逻辑,不在 UI 发明**
- 宠物层不变(渲染模型见 7.13);宠物状态光保留

### 7.8 面板线框(已定)

单窗口 + 工作区切换(标题栏宠物头像 tab)。三栏:

```text
┌ 玻璃标题栏:区名+路径 · 状态汇总 · 工作区切换 ─ □ × ┐
├ 对话列表(玻璃) │ transcript(近实底85%+) │ 右栏可折叠(玻璃) ┤
│ 品种徽标+名+状态点 │ 内嵌:命令卡/diff卡/审批卡  │ Usage(与宠物饥饿联动)│
│ 排序:需介入>活跃>空闲 │ 处理后塌缩留档            │ 上下文占用           │
│ ＋新对话→挑品种   │                          │ 本区状态汇总(与悬停同源)│
├ [🐾harness锁定▾][model▾][权限▾] 输入(/命令) [⏹][发送] ┤
└──────────────────────────────────────────────┘
```

- **审批聚焦态**:气泡【我去处理】→ 面板打开并定位,其余压暗 40%,审批卡琥珀脉冲,底部队列条(还有 N 条);处理完自动消隐
- **材质修订(2026-08-29)**:下图中各栏的"(玻璃)"全部改为实底控制台面(视觉模仿 Codex Desktop,见 7.7);三栏布局与交互流不变
- **状态三处同源**:宠物动作 / 列表状态点 / 气泡颜色,全部出自同一个契约状态聚合函数——加新状态只改契约一处
- harness 在 Composer 左端显示为锁定态(铁律做进 UI)
- 全局宠物面板:同结构,标题栏显示"窝"路径,权限档带"宽松目录·已加固"标识,兼任设置与收容所入口
- v1 非目标:设置深层页、商店、多面板窗口

### 7.9 技术栈决策:**Electron**(对比后推荐)

四条硬约束对比:

| 约束 | Electron | Tauri |
| --- | --- | --- |
| 毛玻璃 | `backgroundMaterial`(Win11 acrylic/mica)+ macOS `vibrancy`,原生支持;Win10 需降级 | window-vibrance 插件,覆盖相当 |
| 透明窗/置顶/点击穿透 | 成熟(transparent+frame:false+setIgnoreMouseEvents) | 成熟 |
| 宠物帧动画 | 捆绑 Chromium,行为一致可预测 | WebView2(Win)同为 Chromium;macOS WKWebView 有差异 |
| **harness 通信(决定项)** | **主进程就是 Node:Claude Agent SDK / ACP / MCP 全是 npm 生态,零桥接;codexhost 的 MIT host-runtime 可直接复用** | 核心 Rust,Node 需 sidecar 旁挂 → 双运行时 + 自建 IPC 桥 |

结论:**Electron**。Tauri 的优势(包体 ~10MB vs ~100MB、内存基线、Rust 安全)对桌面 agent 壳不是决定项;而 harness 生态的 Node 原生性是。毛玻璃在开发机 Win10(10.0.19045)上不可用 acrylic → 降级路径必须在 MVP 第一周实测(Win11 真机/虚拟机验证 acrylic)。

Electron 架构草案:

```text
Main 进程(Node): adapter 层 + (fork 的)host-runtime + 窗口管理
   │ IPC 状态总线(HostEvent 广播)
Renderer-宠物窗(透明置顶): 精灵帧动画 + 气泡 + 状态光
Renderer-面板窗(玻璃): 三栏 UI + transcript + 审批卡
```

### 7.10 v0 Spike 结果(2026-08-29,Win10 19045 / Electron 44 / main 内 Node 22.23)

| Spike | 实测结果 | 判定 |
| --- | --- | --- |
| A 材质降级链 | Win10 正确判定并走"透明窗+近实底内容卡"降级;acrylic 分支代码就位,待 Win11 真机补验 | ✅(Win11 待补) |
| B 透明窗+帧动画 | rAF **75fps**;24fps 动画步进精准(10s 窗口 256 swap≈24×10.7);瞬时长帧 >25ms 全程仅 5 次(<2%),>40ms 仅 3 次 | ✅ 通过 |
| C Claude SDK in main | SDK 载入 ✓ → **Claude Code 会话初始化成功** ✓ → 真实 API 往返 ✓;最终 403 是本机中转网关凭据问题("无权访问 国产模型 分组"),**与 Electron 宿主无关**;系统未装 claude CLI 也跑通了(新版 SDK 内置 CLI,打包利好) | ✅ 通过(凭据待换复测) |
| D 分区点击穿透 | `setIgnoreMouseEvents({forward:true})` 链路通,透明区/精灵悬停切换事件正常触发 | ✅(穿透手感肉眼复核待做) |

实现载体:`npm run spikes`(自测模式,写 `spike-results.json` 自动退出)/ `npm start`(手动模式);宠物素材由 `tools/gen-frames.mjs` 零依赖生成(24 帧 PNG,含手写 PNG 编码器)。
注意:本机 Electron 二进制从 GitHub 下载会卡死,**用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 安装**(命令见 AGENTS.md)。

### 7.11 DyberPet 动作格式速查(已核实官方素材开发文档,spike 已验证)

> 出处:DyberPet `docs/art_dev.md`(2026-08-29 核实);本地验证物:`demo/` 网页播放器(双击 `demo/xiaodai.html` 直跑)。
> 小呆包实测:23 个动作条目 / 17 套素材 / 348 帧;`info.json` 里还带 LLM 人设 prompt(呆啵是 AI 宠物,与本产品方向一致)。

**act_conf.json(单动作定义)**:

| 字段 | 语义 |
| --- | --- |
| `images` | 帧图前缀,`action/<images>_<n>.png` 从 0 连续编号,按序播放 |
| `act_num` | 整段动画重复次数 |
| `frame_refresh` | 单帧停留秒数 |
| `need_move`+`direction`+`frame_move` | 行走:每帧水平位移 px |
| `anchor` `[x,y]` | 相对默认位置平移,+x 向右、**+y 向下**(睡觉等微调贴地);站立类帧要求"地面=图片底边" |

**pet_conf.json(拼装层)**:

- `random_act[]` = **动作组**:`act_list` 按顺序拼接播放;`act_prob` 为相对权重
- `act_type` `[a,b]` = **[饱食度分级, 好感度解锁等级]**(养成数值!不是播放逻辑)——本产品去养成,壳按 `act_prob` 纯权重取用
- `patpat` 字典按饱食度分级映射摸头反应;`feed_N`、`onfloor` 等 `act_prob:0` 的条目是事件触发专用
- 必需动作:`default`/`drag`/`fall`;可选:`prefall`/`onfloor`/`focus`(专注时仅播它)/`hide`(屏幕边缘悬挂)
- 壳的对接结论:**Player 只吃 act_conf,Brain 吃 pet_conf 的动作组与映射**——两层契约天然分离,与第 6 节"契约先行"同构

### 7.12 待定问题(2026-08-30 刷新)

- [ ] **修凭据跑真 turn(最高优先)**:换可用中转 key / `CLAUDE_MODEL=<网关可用模型>` / 直连 API → 验证真实 Claude adapter + 真实审批闭环(模拟已全链路通过,真适配器同契约)
- [ ] Win11 真机补验 acrylic(降级链代码已就位)
- [ ] 第二家 harness(ACP 通用兜底 vs 原生)
- [ ] 侧栏/Agent 条 emoji 图标 → 正式线性图标集
- [ ] 多工作区(宠物=工作区,数据模型已预留;现仅"窝"一个)
- [ ] 会话持久化、Usage-饥饿联动、MVP 收尾范围
- [x] ~~面板/审批闭环的肉眼验证~~(2026-08-30 模拟模式实测:流式/工具卡/审批卡/气泡召唤/宠物状态全通过)
- [x] ~~v1 垂直切片~~(见 7.13)

### 7.13 v1 垂直切片实现(2026-08-29,冒烟通过 ✅)

```
src/shared/contracts.js    契约词汇 + 状态聚合(审批>出错>干活>空闲)
src/adapter/claude-code.js SDK→契约:文本流式(stream_event textDelta)、
                           工具按 assistant/user 完整消息、canUseTool→审批交互
src/host/thread-manager.js 事件事实源:日志落账、状态推导、宠物聚合、双总线广播
src/pet/player.js          act_conf 兼容 Player(吃 小呆/ 等 DyberPet 包):
                           idle=加权随机动作组 / working=focus / waiting=disturbed /
                           error=onfloor;patpat、拖拽(主进程随光标移窗)、审批气泡
src/panel/*                实底控制台三栏(事件流重放渲染):审批卡内嵌消息流、
                           Composer(harness 锁定)、Usage/上下文右栏
src/main/v1-main.js        装配:窝目录(nest/)、PET_PACK/CLAUDE_MODEL 环境变量、
                           --smoke 冒烟模式(自动发一轮 turn,写 v1-smoke.json)
```

- **冒烟结果**:事件链全通 `user → turn.started → thread.meta → item.started → item.updated(textDelta 流式!) → item.completed → turn.completed`;宠物包 23 动作加载成功
- **渲染模型对齐 ToDoList(用户上作,教训换来的)**:窗口=精灵画布(精灵 width:100% 铺满,CSS 单次缩放 → 浏览器同款平滑无锯齿;**严禁 image-rendering: pixelated 用于缩小场景**——曾致"线条感"返工);行走=主进程移动窗口(DWM 整窗位移,撞屏幕边原地踏步);`focusable:false` 点宠不抢焦点。地面光晕给比例参考;滚轮缩放 0.4-2.5x(底边/水平中心锚定,持久化 pet-settings.json)
- 本机中转网关 403("无权访问 国产模型 分组",会话被解析到 DeepSeek-V4-Flash)是**凭据/网关配置问题**,不影响架构;换凭据即可看到真 pong
- **演示模式(2026-08-29)**:`npm run start:mock`(`--mock` → MOCK_TURN=1 → ThreadManager 选用 `src/adapter/mock.js` 的 MockSession),按时序演出完整契约事件流(思考→流式回复→命令卡→文件卡→**真实审批暂停**→收尾),含假 Usage。已端到端走通:面板消息流/工具卡/审批卡"已允许"/Usage 渲染 + 宠物状态闭环
- **两个被演示模式揪出的老 bug**:
  1. **broadcast 空函数吞事件**:模块级 `broadcast` 默认 no-op,只有 smoke 分支重新赋值 → 手动模式下面板/宠物从未收到过任何事件(此前未被发现,因为验收截图全是空首页)。已修复:总线实现统一,smoke 只附加收集钩子
  2. MockSession 构造器漏初始化 `approvals` Map → 首个事件即崩、又被 `start().catch(()=>{})` 静默吞掉 → 面板空白且日志干净。教训:**适配器的会话状态字段必须在构造器初始化;start 的 catch 不要静默,至少 diagnose**
- **真 turn 准备包(2026-08-30)**:① agent 回复走 **markdown 渲染**(marked,先转义 `< >` 防注入再 parse;流式 150ms 节流重渲染,completed 时 flush)② fileChange 卡支持 **unified diff +/- 着色视图**(契约词 `item.unifiedDiff`,mock 已带样例;真实 Edit 的 diff 形状待真 turn 检验后补提取)③ **会话持久化**:事件日志全量落盘 `store/conversations.json`(每事件防抖 600ms,退出兜底),启动恢复(`loadThreads`,运行中会话归位 idle,日志完整重放);smoke 模式不恢复
- **面板渲染层已迁移 React18 + Arco(2026-08-30)**:动机——手写增量 DOM 的 bug 类(双写/陈旧快照/手工映射)在声明式渲染下整体消失;AionUi 同栈便于复刻;Arco 组件白送流式状态(Skeleton/Spin/Collapse)。架构:主进程与 preload 接缝零改动,仅换 `src/panel-app`(Vite 构建到 `build/panel`,Electron loadFile);状态 = useReducer(快照折叠 + 增量事件不可变合并),渲染 = f(state)。**任何全量重画前重拉快照的教训依然适用(7.5 第 4 条)**。流式状态已内建:等首 token 骨架屏、思考中 Spin、流式光标、滚动吸附(用户上翻不被拽回)。smoke 模式不再写会话存储
- v0 spike UI 迁至 `src/spike/`(保留可运行),v1 入口为默认;入口分发在 `src/main/main.js`

### 7.14 真 turn 接入战记(2026-08-30)

- **API 配置机制**:`store/api-config.json`(`{baseUrl, apiKey, model}`,gitignore 内)→ 主进程启动注入 `ANTHROPIC_BASE_URL/AUTH_TOKEN/MODEL`;adapter 以**会话级 settings(flag settings 层,最高优先级)**传给 CLI,避免被用户全局 `~/.claude/settings.json` 的 env 覆盖(本机全局配着旧中转 new-api.abrdns.com + 旧 key + 强制 DeepSeek-V4-Flash)
- **三个连环坑**:
  1. 注入时序:adapter 顶层计算 settings 时 applyApiConfig 还没跑 → 拿到空环境。**需要进程状态的模块必须惰性求值**
  2. 用户全局 settings.json 的 env 块优先级高于继承的进程环境 → 会话级 settings 是唯一干净的覆盖方式(不动用户全局配置)
  3. 关闭扩展思考:`MAX_THINKING_TOKENS=0`(MiniMax 等国产模型只认 thinking type=开启/关闭/自动,CLI 默认思考配置会 400)
- **最终卡点(站主侧)**:新中转(ai.xn--…icu)的 `/v1/messages` 为裸透传,不做 Claude 格式转换——`system` 字段原样转发被上游拒("未知请求字段:system"),**20 个模型全部同样报错**;CLI 必发 system,故该站当前无法承载 CLI。curl 直连(不带 system)能正常拿到 completion,证明 key/模型/网络全通
- 诊断方法沉淀:curl 直连打点二分(带/不带 system、换路径、列模型),把"壳问题 vs 站问题"干净分离

### 7.15 打包战记(2026-08-30 晚,进行中)

- **配置就绪**:`electron-builder.yml`(参考 ToDoList:appId/productName/files 含 `src`+`build/panel`/extraResources 挂 `小呆`/nsis+portable 双目标);图标 `scripts/gen-icon.js`(站帧 → `build/icon.png`,`npm run icon`);命令 `npm run dist`(安装包)/`dist:dir`(免装验证)
- **打包态路径分流**:`v1-main` 已改——可写数据(store/nest/pet-settings)在打包后走 `userData`,宠物包走 `process.resourcesPath/小呆`;开发态不变(APP_ROOT)
- **卡点**:① electron zip 下载慢 → 已过(100%);② winCodeSign 下载 600s 超时(got);③ 跳过 exe 改写(`-c.win.signAndEditExecutable=false`)后又在 unpack 阶段静默退出(127,无错误输出,疑似被会话清理误杀)。**下会话第一步:清锁重跑 ③;若再挂,DEBUG=electron-builder 抓 URL,npmmirror 手动预填 `%LOCALAPPDATA%\electron-builder\Cache`**
- 面板渲染层迁移 React 后,**改面板必须 `npm run panel:build`**(Electron 加载 `build/panel`)——已写入 AGENTS.md 锁定决策
- **真 turn 跑通(2026-08-30)**:站主关闭请求穿透后,`minimax-m2.5` 经壳完整跑通真 turn(流式正文、usage/cost 全真)。收尾适配:MiniMax 系把思考以 `<think>…</think>` 混在正文流——adapter 按标签拆分进 reasoning 条目;SDK `assistant` 完整消息与流式增量是同一份内容,**流式已输出的块在 assistant 阶段只做收尾,不重复追加**(否则双写)

---

## 8. 最终形态(北极星)与演进路线

> 本节是对产品终局的想象草稿,用于对齐长期方向;远期条目多为讨论外推,随讨论持续修订。

### 8.1 一句话北极星

**一群住在你桌面上的宠物,各自驱动着不同的 agent harness:替你干活、向你汇报、找你拿主意——面板只是它们召唤出来的全息操作台。**

### 8.2 终局画面

- **桌面即牧场**:全局宠物常驻;每个项目一只工作区宠物;开机逐只登场;状态光隔着半个屏幕可读
- **面板 = 全息操作台**:召唤式出现,毛玻璃质感,关闭即收回;一切危险操作只发生在这里
- **harness 即品种**:每个 harness 是一个宠物品种;接新 harness = 繁育新品种(adapter);能力表自动驱动 UI 降级
- **MOD 生态(远期想法)**:兼容 DyberPet `act_conf` 帧动画格式,社区贡献形象/动作/音效——美术资产众包,壳只管契约与安全
- **陪伴优先于效率**:不做数值养成;活物感(小动作、对你在场的反应)是产品灵魂

### 8.3 不可妥协的不变式(任何版本)

1. **宠物永不审批**;allow/deny 只发生在面板
2. **对话绑定 harness**,不中途切换
3. **能力来自 harness 原生**(保真),壳不伪造能力——"—"就诚实显示"—"
4. **审批/提问的可见性永远压过**其他状态(聚合优先级顶端)

### 8.4 演进路线(草)

| 阶段 | 内容 |
| --- | --- |
| v0(约 1 周) | 四个技术 spike:acrylic 降级链 / 透明窗+帧动画帧率 / Claude SDK in main / 点击穿透分区 |
| v1(2-3 周) | 垂直切片:一只宠 + Claude Code + 全局面板 + 审批闭环 |
| v1.x | 多工作区宠物、开机动画、状态光、Usage-饥饿联动 |
| v2 | 更多 harness(Codex/Pi/ACP 通用兜底)、MOD 格式兼容、远程机器上的宠物(想法,未讨论) |

---

### 附:讨论中建立的心智模型速查

- 模型 = 思考能力;harness/agent = 干活的程序;壳 = 交互平台
- Codex Desktop 原生只认 Codex;CodexHost = 中间转接头(协议翻译 + 界面注入)
- 壳不削功能,也不造功能;"原生效果"上限 = harness 自己的能力上限
- 切 harness 切的是"AI 用什么方式给你干活",以及"用哪份额度"
