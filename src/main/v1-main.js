// v1 垂直切片主进程:宠物窗(act_conf Player)+ 实底控制台面板 + Claude Code 线程管理。
// 模式:npm start(手动)/ npm run smoke(--smoke,自动发一轮 turn,写 v1-smoke.json)。
'use strict';

// --mock:演示模式,必须在使用 thread-manager 前设置(其顶层按环境选择 adapter)
const MOCK = process.argv.includes("--mock");
if (MOCK) process.env.MOCK_TURN = "1";

const { app, BrowserWindow, ipcMain, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { ThreadManager } = require("../host/thread-manager.js");

const SMOKE = process.argv.includes("--smoke");
// 单实例:重复启动时聚焦已有面板,避免双宠物/数据竞争
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (panelWin && !panelWin.isDestroyed()) {
      panelWin.show();
      panelWin.focus();
    }
  });
}
const APP_ROOT = path.join(__dirname, "..", "..");
// 打包态:可写数据(存储/窝/设置)走 userData,只读宠物包走 extraResources
const DATA_ROOT = app.isPackaged ? app.getPath("userData") : APP_ROOT;
const PACK_DIR = process.env.PET_PACK
  ? path.resolve(process.env.PET_PACK)
  : app.isPackaged
    ? path.join(process.resourcesPath, "小呆")
    : path.join(APP_ROOT, "小呆");
const NEST_DIR = path.join(DATA_ROOT, "nest");
const SETTINGS_FILE = path.join(DATA_ROOT, "pet-settings.json");
const STORE_DIR = path.join(DATA_ROOT, "store");
const CONV_FILE = path.join(STORE_DIR, "conversations.json");
const API_CONFIG_FILE = path.join(STORE_DIR, "api-config.json");

// API 接入配置(store/api-config.json:{ baseUrl, apiKey, model })。
// 注入 Claude Agent SDK 的 CLI 所认的环境变量(继承进子进程),进程环境变量优先于文件。
// 必须在计算 MODEL 之前执行。
(function applyApiConfig() {
  try {
    if (fs.existsSync(API_CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(API_CONFIG_FILE, "utf8"));
      if (cfg.baseUrl) process.env.ANTHROPIC_BASE_URL = cfg.baseUrl;
      if (cfg.apiKey) process.env.ANTHROPIC_AUTH_TOKEN = cfg.apiKey;
      if (cfg.model) process.env.ANTHROPIC_MODEL = cfg.model;
      console.log("[v1] API 配置已加载:", cfg.baseUrl, "| 模型:", cfg.model ?? "(未指定)");
    }
  } catch (error) {
    console.error("[v1] API 配置读取失败:", error.message);
  }
})();
const MODEL = process.env.CLAUDE_MODEL || process.env.ANTHROPIC_MODEL || undefined;

// 会话持久化:事件日志全量落盘,重启恢复(防抖写,退出兜底)
function saveConversations() {
  if (!manager) return;
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(CONV_FILE, JSON.stringify(manager.serialize(), null, 2));
  } catch (error) {
    console.error("[store] 保存失败:", error.message);
  }
}
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveConversations, 600);
}
function restoreConversations() {
  try {
    if (!fs.existsSync(CONV_FILE)) return 0;
    const count = manager.loadThreads(JSON.parse(fs.readFileSync(CONV_FILE, "utf8")));
    if (count) console.log("[v1] 已恢复", count, "个会话");
    return count;
  } catch (error) {
    console.error("[store] 恢复失败:", error.message);
    return 0;
  }
}

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch { return {}; }
}
function saveSettings(patch) {
  const settings = { ...loadSettings(), ...patch };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

let petWin = null;
let panelWin = null;
let manager = null;
let broadcast = () => {};
const smokeEvents = [];

// ---------- 宠物包加载(DyberPet act_conf 格式,笔记 7.11) ----------
function frameNum(f) {
  const m = f.match(/_(\d+)\.png$/);
  return m ? parseInt(m[1], 10) : 0;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// mod 解压常嵌套一层(如 像素猫meme/像素猫meme/pet_conf.json):自动下钻
function resolvePackDir(dir) {
  if (fs.existsSync(path.join(dir, "pet_conf.json"))) return dir;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, "pet_conf.json"))) {
      return path.join(dir, entry.name);
    }
  }
  return dir;
}

// 读 PNG IHDR 拿原生宽高(不用解码整图)
function pngSize(file) {
  const buf = Buffer.alloc(24);
  const fd = fs.openSync(file, "r");
  try {
    fs.readSync(fd, buf, 0, 24, 0);
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } finally {
    fs.closeSync(fd);
  }
}

// 渲染模式:默认平滑(高清手绘);小帧放大判定为像素画 → pixelated;按包可在 pet-settings.json 覆盖
function resolveImageRendering(packDir, petConf, settings, firstFrameFile) {
  const override = settings.packs?.[path.basename(packDir)]?.imageRendering;
  if (override) return override;
  let frameWidth = 0;
  try {
    frameWidth = pngSize(firstFrameFile).width;
  } catch {}
  if (frameWidth > 0 && frameWidth <= 128 && (petConf.scale ?? 1) >= 1) return "pixelated";
  return "auto";
}

function loadPack(dir, settings = {}) {
  const packDir = resolvePackDir(dir);
  const petConf = JSON.parse(fs.readFileSync(path.join(packDir, "pet_conf.json"), "utf8"));
  const actConf = JSON.parse(fs.readFileSync(path.join(packDir, "act_conf.json"), "utf8"));
  const actionDir = path.join(packDir, "action");
  const files = fs.readdirSync(actionDir).filter((f) => f.endsWith(".png"));
  const acts = {};
  let firstFrameFile = null;
  for (const [name, def] of Object.entries(actConf)) {
    const frames = files
      .filter((f) => f.startsWith(`${def.images}_`))
      .sort((a, b) => frameNum(a) - frameNum(b))
      .map((f) => {
        if (!firstFrameFile) firstFrameFile = path.join(actionDir, f);
        return pathToFileURL(path.join(actionDir, f)).href;
      });
    if (!frames.length) continue;
    acts[name] = {
      frames,
      frameRefresh: Math.max(30, (def.frame_refresh ?? 0.1) * 1000),
      actNum: def.act_num ?? 1,
      anchor: def.anchor ?? [0, 0],
      needMove: !!def.need_move,
      direction: def.direction ?? "left",
      frameMove: def.frame_move ?? 0,
    };
  }
  const pick = (name) => (acts[name] ? [name] : []);
  const defAct = pick(petConf.default ?? "default");
  const idle = (petConf.random_act ?? [])
    .filter((g) => (g.act_prob ?? 0) > 0)
    .map((g) => ({ act_list: (g.act_list ?? []).filter((a) => acts[a]), act_prob: g.act_prob }))
    .filter((g) => g.act_list.length);
  // patpat 兼容:字符串(像素猫)或按饱食度分级的字典(小呆)
  const patpatConf = petConf.patpat;
  const patpat = typeof patpatConf === "string"
    ? patpatConf
    : (patpatConf && (patpatConf["3"] ?? patpatConf["2"])) || "patpat1";
  return {
    display: { width: petConf.width ?? 256, height: petConf.height ?? 256, scale: petConf.scale ?? 1 },
    imageRendering: resolveImageRendering(packDir, petConf, settings, firstFrameFile ?? ""),
    acts,
    mapping: {
      idle: idle.length ? idle : [{ act_list: defAct, act_prob: 1 }],
      working: pick(petConf.focus ?? "focus"),
      // 等待审批态:持续循环"被吵醒"动画,直到处理完(用户要求,笔记 7.5)
    waiting: acts["disturbed"] ? ["disturbed"] : defAct,
      error: [...pick(petConf.on_floor ?? "onfloor"), ...defAct],       // 跌倒在地 = 出错
      patpat,
      drag: petConf.drag ?? "drag",
      fall: petConf.fall ?? "fall",
    },
  };
}

function fallbackPack() {
  const dir = path.join(APP_ROOT, "src", "pet", "frames");
  const frames = fs.readdirSync(dir).filter((f) => f.endsWith(".png"))
    .sort((a, b) => frameNum(a) - frameNum(b))
    .map((f) => pathToFileURL(path.join(dir, f)).href);
  return {
    display: { width: 64, height: 64, scale: 2 },
    acts: { default: { frames, frameRefresh: 42, actNum: 1, anchor: [0, 0], needMove: false, direction: "left", frameMove: 0 } },
    mapping: {
      idle: [{ act_list: ["default"], act_prob: 1 }],
      working: ["default"], waiting: ["default"], error: ["default"],
      patpat: "default", drag: "default", fall: "default",
    },
  };
}

// ---------- 窗口 ----------
// 渲染模型对齐 ToDoList:窗口 = 精灵画布(宽=精灵宽,高=精灵高+顶部气泡区),
// 精灵 width:100% 铺满 → CSS 单次缩放,与浏览器一致的无锯齿。
function petWindowSize(pack, zoom = 1) {
  const dw = pack.display.width * pack.display.scale * zoom;
  const dh = pack.display.height * pack.display.scale * zoom;
  // 宽度下限 280:保证审批气泡(264px)在任何小尺寸包里都放得下
  return { width: Math.max(280, Math.ceil(dw)), height: Math.ceil(dh) + 110 };
}

function createPetWindow(pack) {
  const area = screen.getPrimaryDisplay().workArea;
  const size = petWindowSize(pack, loadSettings().zoom ?? 1);
  petWin = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: area.x + area.width - size.width - 24,
    y: area.y + area.height - size.height - 8,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    focusable: false, // 点击宠物不抢焦点(ToDoList 同款)
    movable: false,   // 移动全部由代码控制(drag/walk)
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "..", "pet", "preload.js"),
      // 宠物窗只加载本地帧图;关闭 webSecurity 使 canvas 可读像素(气泡跟随头顶需要测透明边距)
      webSecurity: false,
    },
  });
  petWin.setAlwaysOnTop(true, "screen-saver");
  petWin.loadFile(path.join(__dirname, "..", "pet", "index.html"));
  petWin.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    if (level >= 3) console.error(`[pet ${path.basename(sourceId)}:${line}]`, message);
  });
  petWin.webContents.on("did-finish-load", () =>
    petWin.webContents.send("pet:config", { ...pack, zoom: loadSettings().zoom ?? 1 }));

  // 行走 = 移动窗口(ToDoList 方案):DWM 整窗位移,无重采样;撞屏幕边缘返回 false
  ipcMain.handle("pet:walk", (_e, { direction, px }) => {
    if (!petWin || petWin.isDestroyed()) return false;
    const [wx, wy] = petWin.getPosition();
    const [ww] = petWin.getSize();
    const workArea = screen.getPrimaryDisplay().workArea;
    // setPosition 只收整数,而步长可能是小数(frame_move × scale)
    const x = Math.round(clamp(wx + (direction === -1 ? -px : px), workArea.x, workArea.x + workArea.width - ww));
    if (x === wx) return false;
    petWin.setPosition(x, Math.round(wy));
    return true;
  });

  // 滚轮缩放:窗口随有效倍率自适应,底边与水平中心保持不动,设置持久化
  ipcMain.on("pet:set-zoom", (_e, zoom) => {
    saveSettings({ zoom });
    const { width, height } = petWindowSize(pack, zoom);
    const [wx, wy] = petWin.getPosition();
    const [ww, wh] = petWin.getSize();
    const area = screen.getPrimaryDisplay().workArea;
    const x = clamp(Math.round(wx + (ww - width) / 2), area.x, area.x + area.width - width);
    const y = clamp(Math.round(wy + wh - height), area.y, area.y + area.height - height);
    petWin.setBounds({ x, y, width, height });
  });

  let dragging = false;
  let grab = { dx: 0, dy: 0 };
  ipcMain.on("pet:hit-test", (_e, overUi) => {
    if (petWin && !petWin.isDestroyed()) petWin.setIgnoreMouseEvents(!overUi, { forward: true });
  });
  ipcMain.on("pet:drag-start", () => {
    dragging = true;
    const cursor = screen.getCursorScreenPoint();
    const [wx, wy] = petWin.getPosition();
    grab = { dx: cursor.x - wx, dy: cursor.y - wy };
  });
  ipcMain.on("pet:drag-move", () => {
    if (!dragging || petWin.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    petWin.setPosition(cursor.x - grab.dx, cursor.y - grab.dy);
  });
  ipcMain.on("pet:drag-end", () => { dragging = false; });
  ipcMain.on("pet:poke", () => console.log("[pet] patpat ♥"));
  ipcMain.on("bubble:open", (_e, threadId) => {
    if (!panelWin) return;
    panelWin.show();
    panelWin.focus();
    panelWin.webContents.send("panel:focus-thread", threadId);
  });
}

function createPanelWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  panelWin = new BrowserWindow({
    width: Math.round(area.width * 0.85),   // 初始尺寸:工作区 85% × 85%(用户指定)
    height: Math.round(area.height * 0.85),
    x: area.x + Math.round((area.width * 0.15) / 2),
    y: area.y + Math.round((area.height * 0.15) / 2),
    minWidth: 720,
    minHeight: 480,
    frame: false,
    backgroundColor: "#ffffff", // 面板亮色(AionUi 复刻)
    show: !SMOKE,
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, "..", "panel", "preload.js") },
  });
  panelWin.loadFile(path.join(__dirname, "..", "..", "panel-dist", "index.html"));
  if (!SMOKE) {
    panelWin.once("ready-to-show", () => {
      if (panelWin.isMinimized()) panelWin.restore();
      panelWin.show();
      panelWin.focus();
    });
  }
  panelWin.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    if (level >= 3) console.error(`[panel ${path.basename(sourceId)}:${line}]`, message);
  });
  ipcMain.on("panel:window", (_e, action) => {
    if (action === "min") panelWin.minimize();
    if (action === "close") panelWin.hide(); // "收回",不退出
  });
  ipcMain.handle("panel:snapshot", () => manager.snapshot());
}

// ---------- 线程与 IPC ----------
function firstThread() {
  return manager.snapshot().threads[0]?.threadId ?? null;
}

function bindThreadIpc() {
  ipcMain.handle("thread:create", () =>
    manager.createThread({ cwd: NEST_DIR, model: MODEL, title: "新对话" }).threadId);
  ipcMain.handle("turn:start", (_e, { threadId, text }) => {
    let id = typeof threadId === "string" && manager.snapshot().threads.some((t) => t.threadId === threadId)
      ? threadId
      : firstThread();
    if (!id) id = manager.createThread({ cwd: NEST_DIR, model: MODEL, title: "新对话" }).threadId;
    try {
      manager.startTurn(id, text);
      return { ok: true };
    } catch (error) {
      // 会话运行中重复发送等业务拒绝:不抛未处理异常,回给面板做提示
      return { ok: false, error: String(error?.message ?? error) };
    }
  });
  ipcMain.handle("turn:stop", () => {
    const threadId = firstThread();
    if (threadId) manager.stopTurn(threadId);
  });
  ipcMain.handle("interaction:respond", (_e, { threadId, interactionId, behavior }) =>
    manager.respond(threadId, interactionId, behavior));}

// ---------- 冒烟 ----------
function finishSmoke(reason) {
  const file = path.join(APP_ROOT, "v1-smoke.json");
  fs.writeFileSync(file, JSON.stringify({ reason, events: smokeEvents }, null, 2));
  console.log("SMOKE-RESULTS:", file);
  console.log("SMOKE events:", smokeEvents.map((e) => e.type).join(","));
  app.exit(0);
}

app.whenReady().then(async () => {
  fs.mkdirSync(NEST_DIR, { recursive: true });
  let pack;
  try {
    pack = loadPack(PACK_DIR, loadSettings());
    console.log(`[v1] 宠物包:${PACK_DIR}(${Object.keys(pack.acts).length} 个动作,渲染模式 ${pack.imageRendering})`);
  } catch (error) {
    console.error("[v1] 宠物包加载失败,回退 spike 果冻:", error.message);
    pack = fallbackPack();
  }

  // 事件总线:契约事件 → 面板 + 宠物窗(smoke 模式附带收集)
  let smokeTimer = null;
  broadcast = (channel, payload) => {
    if (SMOKE && channel === "contract:event" && payload) {
      smokeEvents.push(payload);
      if (payload.type === "turn.completed" || payload.type === "turn.failed") {
        clearTimeout(smokeTimer);
        smokeTimer = setTimeout(() => finishSmoke("turn-ended"), 800);
      }
    }
    for (const win of [panelWin, petWin]) {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    }
    if (channel === "contract:event" && !SMOKE) scheduleSave(); // smoke 不污染会话存储
  };

  manager = new ThreadManager({ broadcast: (ch, payload) => broadcast(ch, payload) });
  createPetWindow(pack);
  createPanelWindow();
  bindThreadIpc();

  if (SMOKE) {
    smokeTimer = setTimeout(() => finishSmoke("timeout-45s"), 45_000);
    setTimeout(() => {
      const thread = manager.createThread({ cwd: NEST_DIR, model: MODEL, title: "smoke" });
      manager.startTurn(thread.threadId, "请只回复两个字母:pong");
    }, 1000);
  } else {
    if (restoreConversations() === 0) {
      manager.createThread({ cwd: NEST_DIR, model: MODEL, title: "新对话" });
    } else {
      manager.publish();
    }
    console.log("[v1] 手动模式:右下角宠物 + 控制台面板已就绪。模型:", MODEL ?? "(SDK 默认)",
      MOCK ? "(演示模式:2 秒后自动开演一轮模拟 turn)" : "");
    if (MOCK) {
      setTimeout(() => {
        const threadId = firstThread();
        if (threadId) manager.startTurn(threadId, "演示:走一遍完整流程(含审批)");
      }, 2000);
    }
  }
});

app.on("before-quit", saveConversations);
app.on("window-all-closed", () => app.quit());
