// 实底控制台面板:三栏 + 审批卡 + Composer。
// 渲染即"事件流重放":快照全量画一次,之后按契约事件增量更新(与宠物状态同源,笔记 7.3)。
'use strict';

const $ = (id) => document.getElementById(id);
const listEl = $("thread-list");
const transcriptEl = $("transcript");
const itemEls = new Map();      // itemId -> element
const approvalEls = new Map();  // interactionId -> element
let snapshot = null;
let activeThreadId = null;

const STATE_COLOR = { idle: "#3fbf7f", working: "#4da3ff", waitingInteraction: "#e8b64c", error: "#e06c60" };

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function scrollBottom() {
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}
function activeLog() {
  return snapshot?.log?.[activeThreadId] ?? [];
}
function activeThread() {
  return snapshot?.threads?.find((t) => t.threadId === activeThreadId) ?? null;
}

// ---- 快照全量渲染 ----
async function init() {
  snapshot = await window.panelAPI.snapshot();
  activeThreadId = snapshot.threads[0]?.threadId ?? null;
  renderThreadList();
  renderAll();
  window.panelAPI.onEvent(handleEvent);
  window.panelAPI.onFocusThread(focusThread);
  bindComposer();
}

function renderThreadList() {
  listEl.innerHTML = "";
  for (const t of snapshot.threads) {
    const row = document.createElement("div");
    row.className = "thread" + (t.threadId === activeThreadId ? " active" : "");
    row.innerHTML = `
      <span class="t-dot" style="background:${STATE_COLOR[t.state] ?? "#888"};box-shadow:0 0 6px ${STATE_COLOR[t.state] ?? "#888"}"></span>
      <span class="t-name">${esc(t.title)}</span>
      ${t.pending ? `<span class="t-badge">${t.pending}</span>` : ""}`;
    row.addEventListener("click", () => {
      activeThreadId = t.threadId;
      renderThreadList();
      renderAll();
    });
    listEl.appendChild(row);
  }
  const agg = aggregateState();
  $("agg-dot").style.background = STATE_COLOR[agg] ?? "#888";
  $("agg-dot").style.color = STATE_COLOR[agg] ?? "#888";
}

function aggregateState() {
  const order = { idle: 0, working: 1, error: 2, waitingInteraction: 3 };
  let top = "idle";
  for (const t of snapshot.threads) if ((order[t.state] ?? 0) > (order[top] ?? 0)) top = t.state;
  return top;
}

function renderAll() {
  transcriptEl.innerHTML = "";
  itemEls.clear();
  approvalEls.clear();
  for (const entry of activeLog()) renderEntry(entry);
  renderRail();
  scrollBottom();
}

// ---- 增量事件 ----
async function refreshSnapshot() {
  snapshot = await window.panelAPI.snapshot();
  if (!activeThreadId) activeThreadId = snapshot.threads[0]?.threadId ?? null;
  renderThreadList();
  renderAll();
}

function handleEvent(event) {
  if (!event) return;
  if (event.type === "turn.completed" || event.type === "turn.failed") setBusy(false);
  const t = snapshot.threads.find((x) => x.threadId === event.threadId);
  if (!t) return refreshSnapshot();
  if (t) {
    t.pending = recomputePending(t, event);
    if (event.type === "turn.started" || event.type === "turn.completed" || event.type === "turn.failed" || event.type === "interaction.closed") {
      t.state = deriveState(t);
    }
  }
  renderThreadList();
  if (event.threadId === activeThreadId) renderEntry(event);
  if (event.type === "turn.completed") updateUsageRail(event.outcome?.usage);
  if (event.type === "thread.meta" && t) {
    t.model = event.meta?.model ?? t.model;
    renderRail();
  }
  scrollBottom();
}

function recomputePending(t, event) {
  if (event.type === "interaction.opened") return (t.pending ?? 0) + 1;
  if (event.type === "interaction.closed") return Math.max(0, (t.pending ?? 0) - 1);
  return t.pending ?? 0;
}
function deriveState(t) {
  // 面板侧轻量推导(真源在主进程 ThreadManager,这里只为列表着色跟手)
  const log = snapshot.log[t.threadId] ?? [];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.type === "interaction.opened") return "waitingInteraction";
    if (e.type === "interaction.closed") break;
    if (e.type === "turn.started") return "working";
    if (e.type === "turn.completed") return e.outcome?.status === "failed" ? "error" : "idle";
    if (e.type === "turn.failed") return "error";
  }
  return t.state ?? "idle";
}

// ---- 渲染各类条目 ----
function renderEntry(entry) {
  if (entry.__user) return addUserMessage(entry.text);
  switch (entry.type) {
    case "turn.started": return addDivider("Turn 开始");
    case "thread.meta": {
      const t = activeThread();
      if (t) { t.model = entry.meta?.model ?? t.model; renderRail(); }
      return;
    }
    case "item.started": return renderItemStart(entry.item);
    case "item.updated": return renderItemUpdate(entry);
    case "item.completed": return renderItemCompleted(entry);
    case "interaction.opened": return renderApproval(entry);
    case "interaction.closed": return resolveApproval(entry);
    case "turn.completed": {
      const o = entry.outcome ?? {};
      if (o.status === "failed") return addDivider(`<span class="err">✖ Turn 失败:${esc(o.usage?.error ?? o.result ?? "")}</span>`);
      if (o.status === "cancelled") return addDivider("Turn 已停止");
      return addDivider(`<span class="ok">✔ 完成</span>${o.result ? " · " + esc(String(o.result).slice(0, 120)) : ""}`);
    }
    case "turn.failed":
      return addDivider(`<span class="err">✖ ${esc(entry.error)}</span>`);
  }
}

function addUserMessage(text) {
  const div = document.createElement("div");
  div.className = "msg user";
  div.innerHTML = `<div class="bubble">${esc(text)}</div>`;
  transcriptEl.appendChild(div);
  scrollBottom();
}

function addDivider(html) {
  const div = document.createElement("div");
  div.className = "divider";
  div.innerHTML = html;
  transcriptEl.appendChild(div);
}

function renderItemStart(item) {
  const wrap = document.createElement("div");
  wrap.className = "item";
  if (item.type === "agentMessage") {
    wrap.innerHTML = `<div class="msg"><div class="role">🐾 Claude Code</div><div class="bubble text"></div></div>`;
    transcriptEl.appendChild(wrap);
    itemEls.set(item.itemId, wrap.querySelector(".text"));
    return;
  }
  if (item.type === "reasoning") {
    wrap.innerHTML = `<details class="reasoning card" open><summary>💭 思考过程</summary><pre class="body"></pre></details>`;
  } else if (item.type === "commandExecution") {
    wrap.innerHTML = `
      <div class="card">
        <div class="head"><span class="st inProgress"></span><b>⌘ 命令执行</b></div>
        <div class="mono cmd"></div>
        <details><summary>输出</summary><pre class="out">(运行中…)</pre></details>
      </div>`;
  } else if (item.type === "fileChange") {
    wrap.innerHTML = `
      <div class="card">
        <div class="head"><span class="st inProgress"></span><b>✎ 文件修改</b><span class="mono path"></span></div>
      </div>`;
  } else {
    wrap.innerHTML = `
      <div class="card">
        <div class="head"><span class="st inProgress"></span><b>🔧 ${esc(item.toolName ?? "工具")}</b></div>
        <details><summary>参数</summary><pre class="args"></pre></details>
        <details open><summary>输出</summary><pre class="out">(运行中…)</pre></details>
      </div>`;
  }
  transcriptEl.appendChild(wrap);
  if (item.type === "agentMessage") itemEls.set(item.itemId, wrap.querySelector(".text"));
  else if (item.type === "reasoning") itemEls.set(item.itemId, wrap.querySelector(".body"));
  else {
    if (item.type === "commandExecution") wrap.querySelector(".cmd").textContent = `$ ${item.command ?? ""}`;
    if (item.type === "fileChange") wrap.querySelector(".path").textContent = item.path ?? "";
    if (item.type === "toolExecution") wrap.querySelector(".args").textContent = JSON.stringify(item.arguments ?? {}, null, 2);
    const st = wrap.querySelector(".head .st");
    if (st) itemEls.set(item.itemId + ":st", st);
    itemEls.set(item.itemId, wrap);
  }
  scrollBottom();
}

function renderItemUpdate({ itemId, patch }) {
  const el = itemEls.get(itemId);
  if (!el) return;
  if (patch.textDelta) {
    const target = el.classList?.contains("text") || el.tagName === "PRE" ? el : el.querySelector?.(".bubble.text");
    if (target) target.textContent += patch.textDelta;
  }
  if (patch.output !== undefined) {
    const out = el.querySelector?.(".out");
    if (out) out.textContent = patch.output || "(空输出)";
  }
  if (patch.status) {
    const st = itemEls.get(itemId + ":st");
    if (st) { st.className = `st ${patch.status}`; st.style.animation = "none"; }
  }
  scrollBottom();
}

function renderItemCompleted({ itemId, status }) {
  const el = itemEls.get(itemId);
  if (!el) return;
  const st = itemEls.get(itemId + ":st");
  if (st) { st.className = `st ${status}`; st.style.animation = "none"; }
  if (status === "failed") el.querySelector?.(".out")?.insertAdjacentText("afterbegin", "[失败] ");
}

// ---- 审批卡 ----
function renderApproval({ threadId, interaction }) {
  const wrap = document.createElement("div");
  wrap.className = "item";
  wrap.innerHTML = `
    <div class="card approval" data-interaction="${esc(interaction.interactionId)}">
      <div class="head"><span class="st inProgress" style="background:var(--warn)"></span>
        <b>⚠ 审批 · ${esc(interaction.toolName)}</b></div>
      <div class="mono">${esc(interaction.summary)}</div>
      <details><summary>完整参数</summary><pre>${esc(JSON.stringify(interaction.detail ?? {}, null, 2))}</pre></details>
      <div class="btns">
        <button class="allow">允许本次</button>
        <button>拒绝</button>
      </div>
    </div>`;
  const [allowBtn, denyBtn] = wrap.querySelectorAll("button");
  allowBtn.addEventListener("click", () => decide(threadId, interaction.interactionId, "allow"));
  denyBtn.addEventListener("click", () => decide(threadId, interaction.interactionId, "deny"));
  transcriptEl.appendChild(wrap);
  approvalEls.set(interaction.interactionId, wrap);
  scrollBottom();
}

async function decide(threadId, interactionId, behavior) {
  setApprovalButtons(interactionId, false);
  await window.panelAPI.respond(threadId, interactionId, behavior);
}
function setApprovalButtons(interactionId, enabled) {
  const wrap = approvalEls.get(interactionId);
  wrap?.querySelectorAll(".btns button").forEach((b) => (b.disabled = !enabled));
}
function resolveApproval({ interactionId, resolution }) {
  const wrap = approvalEls.get(interactionId);
  if (!wrap) return;
  setApprovalButtons(interactionId, false);
  const btns = wrap.querySelector(".btns");
  if (btns) btns.outerHTML = `<div class="resolved">${resolution === "allowed" ? "✔ 已允许" : "✖ 已拒绝"}</div>`;
  wrap.querySelector(".head .st")?.style.setProperty("background", resolution === "allowed" ? "var(--ok)" : "var(--err)");
}

function focusThread(threadId) {
  activeThreadId = threadId;
  renderThreadList();
  renderAll();
  const pending = [...approvalEls.values()].find((el) => el.querySelector(".btns"));
  if (pending) {
    pending.scrollIntoView({ block: "center" });
    pending.querySelector(".approval")?.classList.add("flash");
  }
}

// ---- 右栏 ----
function renderRail() {
  const t = activeThread();
  if (!t) return;
  $("rail-model").textContent = t.model ?? "-";
  $("rail-cwd").textContent = t.cwd ?? "-";
  $("rail-pending").textContent = String(t.pending ?? 0);
  $("composer-model").textContent = `model: ${t.model ?? "-"}`;
  $("title-path").textContent = t.cwd ?? "";
}
function updateUsageRail(usage) {
  if (!usage) return;
  $("rail-in").textContent = usage.inputTokens?.toLocaleString() ?? "-";
  $("rail-out").textContent = usage.outputTokens?.toLocaleString() ?? "-";
  $("rail-cost").textContent = usage.costUsd != null ? `$${usage.costUsd.toFixed(4)}` : "-";
  const ctx = usage.inputTokens ?? 0;
  const pct = Math.min(100, Math.round((ctx / 200_000) * 100));
  $("rail-ctx").textContent = ctx.toLocaleString();
  $("ctx-bar").style.width = `${pct}%`;
  $("ctx-bar").style.background = pct > 80 ? "var(--err)" : pct > 55 ? "var(--warn)" : "var(--accent)";
}

// ---- Composer ----
function bindComposer() {
  const input = $("input");
  const send = $("send");
  const stop = $("stop");
  const submit = () => {
    const text = input.value.trim();
    if (!text || !activeThreadId) return;
    input.value = "";
    setBusy(true);
    window.panelAPI.startTurn(text);
  };
  send.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(140, input.scrollHeight) + "px";
  });
  stop.addEventListener("click", () => window.panelAPI.stopTurn());
  $("btn-min").addEventListener("click", () => window.panelAPI.windowAction("min"));
  $("btn-close").addEventListener("click", () => window.panelAPI.windowAction("close"));
}
function setBusy(busy) {
  $("send").style.display = busy ? "none" : "block";
  $("stop").style.display = busy ? "block" : "none";
}

init();
