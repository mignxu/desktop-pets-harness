// act_conf 兼容 Player(自研,格式对齐 DyberPet,笔记 7.11):
//   状态 → 动作组序列;act = 帧序列 + frame_refresh + act_num + anchor + need_move
//   状态机:idle=加权随机动作组 / working=focus 循环 / waitingInteraction=被吵醒 / error=onfloor
//   交互:单击=patpat,拖拽=drag+主进程移窗+松手 fall;审批气泡见 index.html/.bubble
'use strict';

const sprite = document.getElementById("sprite");
const bubbleLayer = document.getElementById("bubbles");
const statusDot = document.getElementById("status-dot");
const stage = document.getElementById("stage");

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
let baseX = 0, baseY = 0; // 精灵默认落位(窗口内)
let moveX = 0;            // need_move 行走位移累积

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function ready(img) {
  if (img.complete) return;
  await new Promise((r) => { img.onload = r; img.onerror = r; });
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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

function layout() {
  const dw = config.display.width * config.display.scale;
  const dh = config.display.height * config.display.scale;
  sprite.style.width = `${dw}px`;
  sprite.style.height = `${dh}px`;
  sprite.style.top = "0";
  baseX = (window.innerWidth - dw) / 2;
  baseY = window.innerHeight - dh - 8; // 地面贴底
  sprite.style.left = `${baseX}px`;
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
      if (act.needMove) moveX += (act.direction === "left" ? -1 : 1) * act.frameMove;
      moveX = clamp(moveX, -46, 46);
      const x = baseX + act.anchor[0] * config.display.scale + moveX;
      const y = baseY + act.anchor[1] * config.display.scale;
      sprite.style.left = `${x}px`;
      sprite.style.top = `${y}px`;
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
function renderBubbles(pending) {
  bubbleLayer.innerHTML = "";
  bubbleLayer.style.top = "6px";
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
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- 点击穿透:只有精灵/气泡可点,其余透传(笔记 Spike D)----
window.addEventListener("mousemove", (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const overUi = !!(el && (el.closest?.("#sprite") || el.closest?.(".bubble")));
  window.petAPI.reportHit(overUi);
});

// ---- 主进程事件 ----
window.petAPI.onConfig((cfg) => {
  config = cfg;
  layout();
  setState("idle", true);
});
window.petAPI.onState(({ state, pending }) => {
  setState(state);
  renderBubbles(state === "waitingInteraction" ? pending : []);
});
window.addEventListener("resize", () => config && layout());
