// v1 垂直切片主进程:宠物窗(act_conf Player)+ 实底控制台面板 + Claude Code 线程管理。
// 模式:npm start(手动)/ npm run smoke(--smoke,自动发一轮 turn,写 v1-smoke.json)。
'use strict';

const { app, BrowserWindow, ipcMain, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { ThreadManager } = require("../host/thread-manager.js");

const SMOKE = process.argv.includes("--smoke");
const APP_ROOT = path.join(__dirname, "..", "..");
const PACK_DIR = process.env.PET_PACK ? path.resolve(process.env.PET_PACK) : path.join(APP_ROOT, "小呆");
const NEST_DIR = path.join(APP_ROOT, "nest");
const MODEL = process.env.CLAUDE_MODEL || process.env.ANTHROPIC_MODEL || undefined;

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

function loadPack(dir) {
  const petConf = JSON.parse(fs.readFileSync(path.join(dir, "pet_conf.json"), "utf8"));
  const actConf = JSON.parse(fs.readFileSync(path.join(dir, "act_conf.json"), "utf8"));
  const actionDir = path.join(dir, "action");
  const files = fs.readdirSync(actionDir).filter((f) => f.endsWith(".png"));
  const acts = {};
  for (const [name, def] of Object.entries(actConf)) {
    const frames = files
      .filter((f) => f.startsWith(`${def.images}_`))
      .sort((a, b) => frameNum(a) - frameNum(b))
      .map((f) => pathToFileURL(path.join(actionDir, f)).href);
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
  return {
    display: { width: petConf.width ?? 256, height: petConf.height ?? 256, scale: petConf.scale ?? 1 },
    acts,
    mapping: {
      idle: idle.length ? idle : [{ act_list: defAct, act_prob: 1 }],
      working: pick(petConf.focus ?? "focus"),
      waiting: [...pick("disturbed"), ...defAct],                       // "被吵醒"= 有事找你
      error: [...pick(petConf.on_floor ?? "onfloor"), ...defAct],       // 跌倒在地 = 出错
      patpat: (petConf.patpat && (petConf.patpat["3"] ?? petConf.patpat["2"])) || "patpat1",
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
function createPetWindow(pack) {
  const area = screen.getPrimaryDisplay().workArea;
  petWin = new BrowserWindow({
    width: 320,
    height: 440,
    x: area.x + area.width - 340,
    y: area.y + area.height - 460,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, "..", "pet", "preload.js") },
  });
  petWin.loadFile(path.join(__dirname, "..", "pet", "index.html"));
  petWin.webContents.on("did-finish-load", () => petWin.webContents.send("pet:config", pack));

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
  panelWin = new BrowserWindow({
    width: 1080,
    height: 700,
    frame: false,
    backgroundColor: "#171a21", // 实底控制台(笔记 7.7 修订)
    show: !SMOKE,
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, "..", "panel", "preload.js") },
  });
  panelWin.loadFile(path.join(__dirname, "..", "panel", "index.html"));
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
  ipcMain.handle("turn:start", (_e, { text }) => {
    let threadId = firstThread();
    if (!threadId) threadId = manager.createThread({ cwd: NEST_DIR, model: MODEL, title: "窝 · 新对话" }).threadId;
    manager.startTurn(threadId, text);
  });
  ipcMain.handle("turn:stop", () => {
    const threadId = firstThread();
    if (threadId) manager.stopTurn(threadId);
  });
  ipcMain.handle("interaction:respond", (_e, { threadId, interactionId, behavior }) =>
    manager.respond(threadId, interactionId, behavior));
}

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
    pack = loadPack(PACK_DIR);
    console.log(`[v1] 宠物包:${PACK_DIR}(${Object.keys(pack.acts).length} 个动作)`);
  } catch (error) {
    console.error("[v1] 宠物包加载失败,回退 spike 果冻:", error.message);
    pack = fallbackPack();
  }

  manager = new ThreadManager({ broadcast: (ch, payload) => broadcast(ch, payload) });
  createPetWindow(pack);
  createPanelWindow();
  bindThreadIpc();

  if (SMOKE) {
    const timer = setTimeout(() => finishSmoke("timeout-45s"), 45_000);
    broadcast = (channel, payload) => {
      if (channel === "contract:event" && payload) {
        smokeEvents.push(payload);
        if (payload.type === "turn.completed" || payload.type === "turn.failed") {
          clearTimeout(timer);
          setTimeout(() => finishSmoke("turn-ended"), 800);
        }
      }
      for (const win of [panelWin, petWin]) {
        if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
      }
    };
    setTimeout(() => {
      const thread = manager.createThread({ cwd: NEST_DIR, model: MODEL, title: "smoke" });
      manager.startTurn(thread.threadId, "请只回复两个字母:pong");
    }, 1000);
  } else {
    manager.createThread({ cwd: NEST_DIR, model: MODEL, title: "窝 · 新对话" });
    console.log("[v1] 手动模式:右下角宠物 + 控制台面板已就绪。模型:", MODEL ?? "(SDK 默认)");
  }
});

app.on("window-all-closed", () => app.quit());
