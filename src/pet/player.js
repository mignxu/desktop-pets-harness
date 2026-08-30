// act_conf 兼容 Player(格式对齐 DyberPet,笔记 7.11)。
// 渲染模型对齐 ToDoList(用户上作,验证过的顺滑方案):
//   窗口 = 精灵画布,精灵 width:100% 铺满 → CSS 单次缩放,与浏览器一致的无锯齿;
//   行走 = 主进程移动窗口(DWM 整窗位移,无内容重采样);
//   anchor[x,y] 经 transform/marginBottom 叠加;状态机:idle 加权动作组 /
//   working=focus / waiting=disturbed / error=onfloor;patpat、拖拽、审批气泡。
'use strict';

const sprite = document.getElementById("sprite");
const bubbleLayer = document.getElementById("bubbles");
const statusDot = document.getElementById("status-dot");
const groundShadow = document.getElementById("ground-shadow");

const STATE_COLORS = {
  idle: "#3fbf7f",
  working: "#4da3ff",
  waitingInteraction: "#e8b64c",
  error: "#e06c60",
};

let config = null;
const imgCache = new Map(); // actName -> Image[]
let runToken = 0;
let currentState = "idle";
let stateBeforeDrag = null;
let lastAct = null;         // 当前动作(zoom 变化后重摆帧位)
let zoom = 1;               // 用户缩放(滚轮,主进程持久化并改窗口尺寸)

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function ready(img) {
  if (img.complete) return;
  await new Promise((r) => { img.onload = r; img.onerror = r; });
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const effScale = () => config.display.scale * zoom;

function ensureImages(actName) {
  if (imgCache.has(actName)) return imgCache.get(actName);
  const imgs = config.acts[actName].frames.map((src) => {
    const img = new Image();
    img.src = src;
    return img;
  });
  imgCache.set(actName, imgs);
  return imgs;
}

// 每帧定位:精灵锚定底部居中,anchor [x, y] 叠加(+y 向下 = marginBottom 负值)
function placeFrame(act) {
  lastAct = act;
  const s = effScale();
  sprite.style.transform = `translateX(calc(-50% + ${(act.anchor[0] ?? 0) * s}px))`;
  sprite.style.marginBottom = `${-(act.anchor[1] ?? 0) * s}px`;
  positionBubbles();
}

function relayout() {
  if (!config) return;
  const dw = config.display.width * effScale();
  const dh = config.display.height * effScale();
  // 精灵定宽(JS),窗口可能比精灵宽(小尺寸包给气泡留位);仍是 CSS 单次缩放
  sprite.style.width = `${dw}px`;
  sprite.style.imageRendering = config.imageRendering ?? "auto";
  const sw = Math.max(60, dw * 0.42);
  const sh = Math.max(10, dh * 0.05);
  groundShadow.style.width = `${sw}px`;
  groundShadow.style.height = `${sh}px`;
  groundShadow.style.left = `${window.innerWidth / 2 - sw / 2}px`;
  groundShadow.style.bottom = `${Math.round(dh * 0.02)}px`;
  if (lastAct) placeFrame(lastAct);
  positionBubbles();
}

// ---- 帧步进 ----
async function playAct(actName, token, { loopUntilTokenChanges = false } = {}) {
  const act = config.acts[actName];
  if (!act || act.frames.length === 0) return;
  const imgs = ensureImages(actName);
  await ready(imgs[0]);
  const repeats = loopUntilTokenChanges ? Number.POSITIVE_INFINITY : Math.max(1, act.actNum);
  for (let r = 0; r < repeats; r++) {
    for (let i = 0; i < imgs.length; i++) {
      if (token !== runToken) return;
      await ready(imgs[i]);
      if (token !== runToken) return;
      sprite.src = imgs[i].src;
      if (act.needMove && act.frameMove) {
        // 行走 = 移动窗口;撞屏幕边缘返回 false → 原地踏步
        window.petAPI.walk(act.direction === "left" ? -1 : 1, act.frameMove * effScale());
      }
      placeFrame(act);
      await wait(act.frameRefresh);
    }
  }
}

// ---- 状态机 ----
function pickSequence(state) {
  const m = config.mapping;
  const fallback = ["default"];
  switch (state) {
    case "working": return m.working.length ? m.working : fallback;
    case "waitingInteraction": return m.waiting.length ? m.waiting : fallback;
    case "error": return m.error.length ? m.error : fallback;
    default: {
      const groups = m.idle.filter((g) => g.act_prob > 0 && g.act_list.length);
      if (!groups.length) return fallback;
      const total = groups.reduce((s, g) => s + g.act_prob, 0);
      let roll = Math.random() * total;
      for (const g of groups) {
        roll -= g.act_prob;
        if (roll <= 0) return g.act_list;
      }
      return groups[0].act_list;
    }
  }
}

function setState(state, force = false) {
  if (!force && state === currentState) return;
  currentState = state;
  runToken += 1;
  const token = runToken;
  statusDot.style.background = STATE_COLORS[state] ?? "#888";
  statusDot.style.color = STATE_COLORS[state] ?? "#888";
  (async () => {
    while (token === runToken) {
      for (const actName of pickSequence(state)) {
        if (token !== runToken) return;
        if (!config.acts[actName]) continue;
        await playAct(actName, token);
      }
    }
  })();
}

// ---- 打断式动作(patpat / 松手 fall):播完回到当前状态 ----
async function playInterrupt(sequence) {
  runToken += 1;
  const token = runToken;
  for (const actName of sequence) {
    if (token !== runToken) return;
    await playAct(actName, token);
  }
  setState(currentState, true);
}

// ---- 交互:单击 patpat;按住拖拽 ----
let press = null;
sprite.addEventListener("mousedown", (e) => {
  press = { x: e.screenX, y: e.screenY, t: Date.now(), moved: false };
  stateBeforeDrag = currentState;
  window.petAPI.dragStart();
  runToken += 1;
  const token = runToken;
  (async () => {
    while (token === runToken) await playAct(config.mapping.drag, token, { loopUntilTokenChanges: true });
  })();
});
window.addEventListener("mousemove", (e) => {
  if (!press) return;
  if (Math.abs(e.screenX - press.x) + Math.abs(e.screenY - press.y) > 6) press.moved = true;
  window.petAPI.dragMove(e.screenX, e.screenY);
});
window.addEventListener("mouseup", () => {
  if (!press) return;
  const quick = !press.moved && Date.now() - press.t < 400;
  press = null;
  window.petAPI.dragEnd();
  if (quick) {
    window.petAPI.poke();
    playInterrupt([config.mapping.patpat].filter(Boolean));
  } else if (config.acts[config.mapping.fall]) {
    playInterrupt([config.mapping.fall]);
  } else {
    setState(stateBeforeDrag ?? "idle", true);
  }
});

// ---- 审批迷你气泡 ----
// 气泡跟随角色头顶:量当前帧的透明上边距(ToDoList frameTops 方案),
// 把气泡 bottom 锚到"可见的头顶"而不是帧图顶(帧图常有大量透明留白)。
const headTops = new Map(); // frame src -> 头顶透明边距(自然像素)
function topAlphaOf(src) {
  let value = headTops.get(src);
  if (value !== undefined) return value;
  value = 0;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = sprite.naturalWidth;
    canvas.height = sprite.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(sprite, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    outer: for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (data[(y * canvas.width + x) * 4 + 3] > 16) { value = y; break outer; }
      }
    }
  } catch {
    value = 0; // 像素不可读(安全策略)时退化为帧顶
  }
  headTops.set(src, value);
  return value;
}

function positionBubbles() {
  if (!bubbleLayer.firstElementChild || !sprite.naturalWidth) return;
  const rect = sprite.getBoundingClientRect();
  const headTop = rect.top + topAlphaOf(sprite.src) * (rect.height / sprite.naturalHeight);
  bubbleLayer.style.top = "auto";
  bubbleLayer.style.bottom = `${Math.max(4, Math.round(window.innerHeight - headTop + 8))}px`;
}

function renderBubbles(pending) {
  bubbleLayer.innerHTML = "";
  bubbleLayer.style.pointerEvents = pending.length ? "auto" : "none";
  for (const item of pending) {
    const card = document.createElement("div");
    card.className = "bubble";
    card.innerHTML = `
      <div class="b-title">🐾 ${escapeHtml(item.toolName)} 想执行操作</div>
      <div class="b-summary" title="${escapeHtml(item.summary)}">${escapeHtml(item.summary)}</div>
      <button>我去处理</button>`;
    card.querySelector("button").addEventListener("click", () => window.petAPI.bubbleOpen(item.threadId));
    bubbleLayer.appendChild(card);
  }
  positionBubbles();
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- 点击穿透:只有精灵/气泡可点,其余透传 ----
window.addEventListener("mousemove", (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const overUi = !!(el && (el.closest?.("#sprite") || el.closest?.(".bubble")));
  window.petAPI.reportHit(overUi);
});

// ---- 滚轮缩放:只报主进程,窗口 resize 后 resize 事件触发 relayout ----
window.addEventListener("wheel", (e) => {
  if (!config) return;
  const next = clamp(Math.round((zoom + (e.deltaY < 0 ? 0.1 : -0.1)) * 10) / 10, 0.4, 2.5);
  if (next === zoom) return;
  zoom = next;
  window.petAPI.setZoom(zoom);
}, { passive: true });

// ---- 主进程事件 ----
window.petAPI.onConfig((cfg) => {
  config = cfg;
  zoom = clamp(cfg.zoom ?? 1, 0.4, 2.5);
  relayout();
  setState("idle", true);
});
window.petAPI.onState(({ state, pending }) => {
  setState(state);
  renderBubbles(state === "waitingInteraction" ? pending : []);
});
window.addEventListener("resize", relayout);
