// v0 技术验证入口(npm run spikes / --self-test),UI 已迁至 src/spike/:
//   Spike A:毛玻璃材质解析与降级链(spike/panel.html)
//   Spike B:透明置顶窗 + 帧动画 + FPS(spike/pet.html,结果经 IPC 汇总)
//   Spike C:Claude Agent SDK 在 Electron main 内运行
//   Spike D:宠物窗分区点击穿透
// 结果写 spike-results.json。真实产品入口在 v1-main.js。
const { app, BrowserWindow, ipcMain } = require("electron");
const { execSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const os = require("node:os");

const SELF_TEST = process.argv.includes("--self-test") || process.env.SPIKE_SELFTEST === "1";
const METRICS_MS = SELF_TEST ? 10_000 : 0;

const results = {
  startedAt: new Date().toISOString(),
  selfTest: SELF_TEST,
  env: {},
  spikeA: {},
  spikeB: {},
  spikeC: {},
  spikeD: {},
};

function resolveBackgroundMaterial() {
  if (process.platform !== "win32") {
    return { material: "none", strategy: process.platform === "darwin" ? "vibrancy" : "translucent", reason: `platform=${process.platform}` };
  }
  const build = Number(os.release().split(".")[2] || 0);
  if (build >= 22621) return { material: "acrylic", strategy: "backgroundMaterial", reason: `Win11 build ${build}` };
  return { material: "none", strategy: "transparent+rgba-fallback", reason: `Win10 build ${build}: acrylic 为 Win11 特性,走降级` };
}

function gpuStatus() {
  try {
    return app.getGPUFeatureStatus();
  } catch (error) {
    return { error: String(error) };
  }
}

function createPanelWindow(effect) {
  const win = new BrowserWindow({
    width: 660,
    height: 440,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    ...(effect.material !== "none" ? { backgroundMaterial: effect.material } : {}),
    ...(process.platform === "darwin" ? { vibrancy: "under-window" } : {}),
    alwaysOnTop: true,
    resizable: false,
    webPreferences: { contextIsolation: true },
  });
  const query = new URLSearchParams({
    material: effect.material,
    strategy: effect.strategy,
    reason: effect.reason,
    electron: process.versions.electron,
    node: process.versions.node,
    gpu: JSON.stringify(results.env.gpu),
  });
  win.loadFile(join(__dirname, "..", "spike", "panel.html"), { search: query.toString() });
  return win;
}

function createPetWindow() {
  const { workArea } = require("electron").screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: 200,
    height: 220,
    x: workArea.x + workArea.width - 220,
    y: workArea.y + workArea.height - 240,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    webPreferences: {
      contextIsolation: true,
      preload: join(__dirname, "..", "spike", "preload.js"),
    },
  });
  win.loadFile(join(__dirname, "..", "spike", "pet.html"));
  return win;
}

function bindSpikeIpc(win) {
  ipcMain.on("pet:hit-test", (_event, overSprite) => {
    try {
      win.setIgnoreMouseEvents(!overSprite, { forward: true });
      if (results.spikeD.lastState !== overSprite) {
        results.spikeD.lastState = overSprite;
        results.spikeD.toggles = (results.spikeD.toggles || 0) + 1;
      }
      results.spikeD.apiOk = true;
    } catch (error) {
      results.spikeD.apiOk = false;
      results.spikeD.error = String(error);
    }
  });
  ipcMain.on("pet:metrics", (_event, metrics) => {
    results.spikeB = { ...results.spikeB, ...metrics };
  });
}

function claudeCliOnPath() {
  try {
    const out = execSync("where claude", { stdio: ["ignore", "pipe", "ignore"] }).toString();
    return { installed: true, path: out.split(/\r?\n/)[0].trim() };
  } catch {
    return { installed: false };
  }
}

async function spikeClaudeSdk() {
  const entry = { sdkLoaded: false, startedAt: new Date().toISOString() };
  try {
    const mod = await import("@anthropic-ai/claude-agent-sdk");
    entry.sdkLoaded = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("spike-timeout-15s")), 15_000);
    try {
      const conversation = mod.query({
        prompt: "Reply with exactly one word: pong",
        options: { maxTurns: 1, abortController: controller },
      });
      let sawResult = false;
      for await (const message of conversation) {
        if (message?.type === "system" && message.subtype === "init") entry.sessionInit = true;
        if (message?.type === "result") {
          sawResult = true;
          entry.resultSubtype = message.subtype;
          entry.reply = String(message.result ?? "").slice(0, 80);
        }
      }
      entry.outcome = sawResult ? "ok" : "no-result";
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const text = String(error?.message ?? error);
    entry.error = text.slice(0, 300);
    if (/ENOENT|not found|cannot find/i.test(text)) entry.outcome = "cli-missing";
    else if (/auth|api key|credit|login|oauth|403|401/i.test(text)) entry.outcome = "auth-required";
    else if (/spike-timeout/.test(text)) entry.outcome = "timeout";
    else entry.outcome = "other";
  } finally {
    entry.finishedAt = new Date().toISOString();
  }
  return entry;
}

app.whenReady().then(async () => {
  results.env = {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    osRelease: os.release(),
    platform: process.platform,
    gpu: gpuStatus(),
  };
  const effect = resolveBackgroundMaterial();
  results.spikeA = { ...effect };

  createPanelWindow(effect);
  const pet = createPetWindow();
  bindSpikeIpc(pet);

  results.spikeC = SELF_TEST || process.env.SPIKE_RUN_SDK === "1"
    ? await spikeClaudeSdk()
    : { skipped: true, hint: "npm run spikes 或 SPIKE_RUN_SDK=1 触发" };
  results.spikeC.cli = claudeCliOnPath();

  if (SELF_TEST) {
    await new Promise((resolve) => setTimeout(resolve, METRICS_MS));
    results.finishedAt = new Date().toISOString();
    const outFile = join(app.getAppPath(), "spike-results.json");
    writeFileSync(outFile, JSON.stringify(results, null, 2));
    console.log("SPIKE-RESULTS:", outFile);
    for (const [key, value] of Object.entries(results)) {
      if (key !== "env") console.log(`SPIKE ${key}:`, JSON.stringify(value));
    }
    app.exit(0);
  } else {
    console.log("[v0 spike] 手动模式。Spike C 触发:SPIKE_RUN_SDK=1 npm run spikes");
  }
});

app.on("window-all-closed", () => app.quit());
process.on("uncaughtException", (error) => {
  results.fatal = String(error?.stack ?? error).slice(0, 500);
  try { writeFileSync(join(app.getAppPath(), "spike-results.json"), JSON.stringify(results, null, 2)); } catch {}
  console.error("FATAL:", results.fatal);
  app.exit(1);
});
