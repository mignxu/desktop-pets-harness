// 面板状态机:快照(全量折叠) + 增量事件(不可变合并)。
// 渲染 = f(state),消灭手写增量 DOM 的一整类 bug(笔记 7.5/7.13 的教训)。
export const initialState = {
  loaded: false,
  threads: [],
  logs: {},   // threadId -> Entry[](有序)
  items: {},  // itemId -> 归一化视图 {itemId,type,status,text,output,command,cwd,toolName,arguments,path,unifiedDiff}
  activeThreadId: null,
  needsRefresh: false,
};

const STATE_ORDER = { idle: 0, working: 1, error: 2, waitingInteraction: 3 };

export function aggregateState(threads) {
  let top = "idle";
  for (const t of threads) if ((STATE_ORDER[t.state] ?? 0) > (STATE_ORDER[top] ?? 0)) top = t.state;
  return top;
}

function foldEntry(items, entry) {
  if (entry.type === "item.started") {
    const it = entry.item;
    return { ...items, [it.itemId]: { ...it, status: it.status ?? "inProgress", text: it.text ?? "" } };
  }
  if (entry.type === "item.updated") {
    const view = items[entry.itemId];
    if (!view) return items;
    const next = { ...view };
    if (entry.patch.textDelta !== undefined) next.text = (next.text ?? "") + entry.patch.textDelta;
    if (entry.patch.output !== undefined) next.output = entry.patch.output;
    if (entry.patch.status) next.status = entry.patch.status;
    return { ...items, [entry.itemId]: next };
  }
  if (entry.type === "item.completed") {
    const view = items[entry.itemId];
    if (!view) return items;
    return { ...items, [entry.itemId]: { ...view, status: entry.status } };
  }
  return items;
}

function foldEntries(items, entries) {
  return entries.reduce(foldEntry, items);
}

function threadPatch(t, e) {
  const next = { ...t };
  if (e.type === "turn.started") next.state = "working";
  if (e.type === "interaction.opened") { next.state = "waitingInteraction"; next.pending = (next.pending ?? 0) + 1; }
  if (e.type === "interaction.closed") {
    next.pending = Math.max(0, (next.pending ?? 0) - 1);
    if (next.pending === 0) next.state = "working";
  }
  if (e.type === "thread.meta") next.model = e.meta?.model ?? next.model;
  if (e.type === "turn.completed") {
    next.usage = e.outcome?.usage ?? next.usage;
    next.state = e.outcome?.status === "failed" ? "error" : "idle";
  }
  if (e.type === "turn.failed") next.state = "error";
  return next;
}

function applySnapshot(state, snapshot, selectThreadId) {
  const logs = {};
  let items = {};
  for (const [tid, entries] of Object.entries(snapshot.log ?? {})) {
    logs[tid] = entries;
    items = foldEntries(items, entries);
  }
  const keepActive = state.activeThreadId &&
    snapshot.threads.some((t) => t.threadId === state.activeThreadId)
    ? state.activeThreadId
    : null;
  return {
    ...state,
    loaded: true,
    needsRefresh: false,
    threads: snapshot.threads,
    logs,
    items,
    activeThreadId: selectThreadId ?? keepActive ?? snapshot.threads[0]?.threadId ?? null,
  };
}

function reducer(state = initialState, action) {
  switch (action.type) {
    case "snapshot":
      return applySnapshot(state, action.snapshot, action.selectThreadId);
    case "event": {
      const e = action.event;
      if (!e || !e.threadId) return state;
      if (!state.threads.some((t) => t.threadId === e.threadId)) {
        return { ...state, needsRefresh: true }; // 未知会话:由 effect 重拉快照
      }
      const threads = state.threads.map((t) => (t.threadId === e.threadId ? threadPatch(t, e) : t));
      const logs = { ...state.logs, [e.threadId]: [...(state.logs[e.threadId] ?? []), e] };
      const items = foldEntry(state.items, e);
      return { ...state, threads, logs, items };
    }
    case "select":
      return { ...state, activeThreadId: action.threadId };
    default:
      return state;
  }
}

export default reducer;
