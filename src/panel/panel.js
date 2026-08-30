// 面板逻辑(ChatGPT Desktop 视觉,亮色极简):
// 渲染即"事件流重放":快照全量画一次,之后按契约事件增量更新(与宠物状态同源,笔记 7.3)。
'use strict';

const $ = (id) => document.getElementById(id);
const transcriptEl = $("transcript");
const innerEl = $("transcript-inner");
const itemEls = new Map();      // itemId -> element(文本节点或卡片)
const approvalEls = new Map();  // interactionId -> element
let snapshot = null;
let activeThreadId = null;

const STATE_COLOR = { idle: "#10a37f", working: "#10a37f", waitingInteraction: "#d97706", error: "#ef4444" };

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
function aggregateState() {
  const order = { idle: 0, working: 1, error: 2, waitingInteraction: 3 };
  let top = "idle";
  for (const t of snapshot.threads) if ((order[t.state] ?? 0) > (order[top] ?? 0)) top = t.state;
  return top;
}

// ---- 快照全量渲染 ----
async function init() {
  snapshot = await window.panelAPI.snapshot();
  activeThreadId = snapshot.threads[0]?.threadId ?? null;
  renderAll();
  window.panelAPI.onEvent(handleEvent);
  window.panelAPI.onFocusThread(focusThread);
  bindComposer();
  // AionUi 的"新对话":立即建会话并切过去(空会话显示首页构图)
  $("new-thread").addEventListener("click", async () => {
    activeThreadId = await window.panelAPI.createThread();
    snapshot = await window.panelAPI.snapshot();
    renderAll();
    $("input").focus();
  });
  $("ws-add").addEventListener("click", async () => {
    activeThreadId = await window.panelAPI.createThread();
    snapshot = await window.panelAPI.snapshot();
    renderAll();
    $("input").focus();
  });
  $("theme-toggle").addEventListener("click", () => {}); // 逻辑后加
}

function renderAll() {
  renderSider();
  renderTranscript();
  renderRail();
}

// AionUi Sider 结构:工作区(Projects)组内嵌对话行;独立"对话"节暂无数据
function renderSider() {
  const listEl = $("ws-threads");
  listEl.innerHTML = "";
  for (const t of snapshot.threads) {
    const row = document.createElement("div");
    row.className = "row-btn conv" + (t.threadId === activeThreadId ? " active" : "");
    row.title = t.harnessId === "claude-code" ? "Claude Code(对话绑定 harness,铁律)" : t.harnessId;
    row.innerHTML = `
      <span class="conv-icon">🐾</span>
      <span class="lbl">${esc(t.title)}</span>
      ${t.pending ? `<span class="t-badge">${t.pending}</span>` : ""}
      ${t.state !== "idle" ? `<span class="run-dot" style="background:${STATE_COLOR[t.state]}"></span>` : ""}`;
    row.addEventListener("click", async () => {
      snapshot = await window.panelAPI.snapshot(); // 全量重画前拉新快照(见 focusThread 注)
      activeThreadId = t.threadId;
      renderAll();
    });
    listEl.appendChild(row);
  }
  $("conv-section").style.display = "none"; // v1 对话全挂"窝"下;多工作区逻辑后加
  const agg = aggregateState();
  document.title =
    agg === "idle" ? "桌宠壳" : agg === "waitingInteraction" ? "桌宠壳 · 等你处理" : "桌宠壳 · 干活中";
}

function renderTranscript() {
  innerEl.innerHTML = "";
  itemEls.clear();
  approvalEls.clear();
  const log = activeLog();
  // 首页构图(问候语+Agent条+Composer 居中)与 会话构图 由 body.has-messages 切换
  document.body.classList.toggle("has-messages", log.length > 0);
  for (const entry of log) renderEntry(entry);
  scrollBottom();
}

// ---- 增量事件 ----
async function refreshSnapshot() {
  snapshot = await window.panelAPI.snapshot();
  if (!activeThreadId) activeThreadId = snapshot.threads[0]?.threadId ?? null;
  renderAll();
}

function handleEvent(event) {
  if (!event) return;
  if (event.type === "turn.completed" || event.type === "turn.failed") setBusy(false);
  const t = snapshot.threads.find((x) => x.threadId === event.threadId);
  if (!t) return refreshSnapshot();
  if (event.type === "interaction.opened") t.pending = (t.pending ?? 0) + 1;
  if (event.type === "interaction.closed") t.pending = Math.max(0, (t.pending ?? 0) - 1);
  if (event.type === "thread.meta") t.model = event.meta?.model ?? t.model;
  if (event.type === "turn.completed") t.usage = event.outcome?.usage ?? t.usage;
  if (event.threadId !== activeThreadId) {
    renderSider();
    return;
  }
  ensureNotEmpty();
  renderEntry(event);
  renderSider();
  renderRail();
  scrollBottom();
}
function ensureNotEmpty() {
  if (!document.body.classList.contains("has-messages")) {
    document.body.classList.add("has-messages");
    innerEl.innerHTML = "";
  }
}

// ---- 渲染各类条目 ----
function renderEntry(entry) {
  if (entry.__user) return addUserMessage(entry.text);
  switch (entry.type) {
    case "turn.started": return addDivider("Turn 开始");
    case "thread.meta": return renderRail();
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
  innerEl.appendChild(div);
}

function addDivider(html) {
  const div = document.createElement("div");
  div.className = "divider";
  div.innerHTML = html;
  innerEl.appendChild(div);
}

function renderItemStart(item) {
  const wrap = document.createElement("div");
  wrap.className = "item";
  if (item.type === "agentMessage") {
    wrap.className = "msg agent";
    wrap.innerHTML = `<div class="text"></div>`;
    innerEl.appendChild(wrap);
    itemEls.set(item.itemId, wrap.querySelector(".text"));
    return;
  }
  if (item.type === "reasoning") {
    wrap.innerHTML = `<details class="reasoning" open><summary>💭 思考过程</summary><pre class="body"></pre></details>`;
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
  innerEl.appendChild(wrap);
  if (item.type === "commandExecution") wrap.querySelector(".cmd").textContent = `$ ${item.command ?? ""}`;
  if (item.type === "fileChange") wrap.querySelector(".path").textContent = item.path ?? "";
  if (item.type === "toolExecution") wrap.querySelector(".args").textContent = JSON.stringify(item.arguments ?? {}, null, 2);
  const st = wrap.querySelector(".head .st");
  if (st) itemEls.set(item.itemId + ":st", st);
  itemEls.set(item.itemId, wrap);
}

function renderItemUpdate({ itemId, patch }) {
  const el = itemEls.get(itemId);
  if (!el) return;
  if (patch.textDelta) {
    const target = el.tagName === "DIV" || el.tagName === "PRE" ? el : el.querySelector?.(".text");
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
        <button class="deny">拒绝</button>
      </div>
    </div>`;
  const [allowBtn, denyBtn] = wrap.querySelectorAll("button");
  allowBtn.addEventListener("click", () => decide(threadId, interaction.interactionId, "allow"));
  denyBtn.addEventListener("click", () => decide(threadId, interaction.interactionId, "deny"));
  innerEl.appendChild(wrap);
  approvalEls.set(interaction.interactionId, wrap);
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
}

// 注意:IPC snapshot 是结构化克隆的"当时副本",事件只做增量渲染;
// 任何全量重画(切换对话/召唤聚焦)前必须重新拉快照,否则渲染的是陈旧数据
async function focusThread(threadId) {
  snapshot = await window.panelAPI.snapshot();
  activeThreadId = threadId;
  renderAll();
  const pending = [...approvalEls.values()].find((el) => el.querySelector(".btns"));
  if (pending) {
    pending.scrollIntoView({ block: "center" });
    pending.querySelector(".approval")?.classList.add("flash");
  }
}

// ---- 侧栏底部元信息(替代原右栏) ----
function renderRail() {
  const t = activeThread();
  const cwdName = t?.cwd ? t.cwd.split(/[\\/]/).filter(Boolean).pop() : "窝";
  $("cwd-chip").textContent = `📁 ${cwdName} ⌄`;
  $("model-chip").textContent = t?.model ? `${t.model} ⌄` : "model ⌄";
  const usage = t?.usage;
  const ctx = usage?.inputTokens ?? 0;
  const pct = Math.min(100, Math.round((ctx / 200_000) * 100));
  $("side-foot").innerHTML = `
    <div class="row"><span>模型</span><span class="mono">${esc(t?.model ?? "-")}</span></div>
    <div class="row"><span>输入 / 输出</span><span class="mono">${(usage?.inputTokens ?? 0).toLocaleString()} / ${(usage?.outputTokens ?? 0).toLocaleString()}</span></div>
    <div class="row"><span>费用</span><span class="mono">${usage?.costUsd != null ? "$" + usage.costUsd.toFixed(4) : "-"}</span></div>
    <div class="ctx-bar"><div style="width:${pct}%;background:${pct > 80 ? "var(--err)" : pct > 55 ? "var(--warn)" : "var(--ok)"}"></div></div>
    <div class="row"><span>上下文占用</span><span class="mono">${pct}%</span></div>`;
}

// ---- Composer ----
function bindComposer() {
  const input = $("input");
  const send = $("send");
  const stop = $("stop");
  const submit = async () => {
    const text = input.value.trim();
    if (!text || !activeThreadId) return;
    input.value = "";
    input.style.height = "auto";
    setBusy(true);
    const res = await window.panelAPI.startTurn(activeThreadId, text);
    if (res && res.ok === false) {
      setBusy(false);
      toast(res.error);
    }
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
  $("send").style.display = busy ? "none" : "flex";
  $("stop").style.display = busy ? "flex" : "none";
}

// 轻提示(业务拒绝,如会话运行中重复发送)
function toast(message) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.style.cssText = [
      "position:fixed", "left:50%", "bottom:110px", "transform:translateX(-50%)",
      "background:rgba(13,16,28,.92)", "color:#fff", "font-size:12.5px",
      "padding:8px 16px", "border-radius:999px", "z-index:99",
      "opacity:0", "transition:opacity .2s", "pointer-events:none",
    ].join(";");
    document.body.appendChild(el);
  }
  el.textContent = message;
  requestAnimationFrame(() => (el.style.opacity = "1"));
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.style.opacity = "0"), 2400);
}

init();
