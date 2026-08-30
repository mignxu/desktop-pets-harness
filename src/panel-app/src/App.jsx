import React, { useEffect, useReducer, useState } from "react";
import reducer, { aggregateState, initialState } from "./store.js";
import Sider from "./components/Sider.jsx";
import Transcript from "./components/Transcript.jsx";
import Composer from "./components/Composer.jsx";

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [focusSeq, setFocusSeq] = useState(0);

  useEffect(() => {
    (async () => {
      dispatch({ type: "snapshot", snapshot: await window.panelAPI.snapshot() });
    })();
    window.panelAPI.onEvent((event) => dispatch({ type: "event", event }));
    window.panelAPI.onFocusThread(async (threadId) => {
      // 召唤聚焦:全量重画前必须重拉快照(IPC 副本不随事件增长,笔记 7.5)
      dispatch({ type: "snapshot", snapshot: await window.panelAPI.snapshot(), selectThreadId: threadId });
      setFocusSeq((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    if (!state.needsRefresh) return;
    (async () => dispatch({ type: "snapshot", snapshot: await window.panelAPI.snapshot() }))();
  }, [state.needsRefresh]);

  const active = state.threads.find((t) => t.threadId === state.activeThreadId) ?? null;
  const busy = active?.state === "working" || active?.state === "waitingInteraction";
  const agg = aggregateState(state.threads);
  const hasMessages = (state.logs[state.activeThreadId] ?? []).length > 0;

  useEffect(() => {
    document.body.classList.toggle("has-messages", hasMessages);
  }, [hasMessages]);

  useEffect(() => {
    document.title =
      agg === "idle" ? "桌宠壳" : agg === "waitingInteraction" ? "桌宠壳 · 等你处理" : "桌宠壳 · 干活中";
  }, [agg]);

  const handleNewThread = async () => {
    const threadId = await window.panelAPI.createThread();
    dispatch({ type: "snapshot", snapshot: await window.panelAPI.snapshot(), selectThreadId: threadId });
  };

  const handleSelect = (threadId) => dispatch({ type: "select", threadId });

  return (
    <div id="app">
      <div id="titlebar">
        <div className="spacer" />
        <button id="btn-min" title="最小化" onClick={() => window.panelAPI.windowAction("min")}>—</button>
        <button id="btn-close" title="收回宠物" onClick={() => window.panelAPI.windowAction("close")}>✕</button>
      </div>
      <div id="body">
        <Sider
          state={state}
          activeThreadId={state.activeThreadId}
          onSelect={handleSelect}
          onNew={handleNewThread}
        />
        <main id="main">
          <Transcript
            entries={state.logs[state.activeThreadId] ?? []}
            items={state.items}
            thread={active}
            loaded={state.loaded}
            focusSeq={focusSeq}
          />
          {!hasMessages && (
            <div id="empty-cluster">
              <div className="greeting">今天让宠物干点什么?</div>
              <div className="agent-bar">
                <span className="agent-pill" title="对话绑定 harness,不可中途切换(铁律)">
                  <span className="ap-icon">🐾</span> Claude Code
                </span>
                <button className="add-agent" title="接入更多 harness(逻辑后加)" disabled>+</button>
              </div>
              <div className="empty-hint">输入任务派活;需要审批时,宠物会来喊你</div>
            </div>
          )}
          <Composer
            activeThreadId={state.activeThreadId}
            active={active}
            busy={busy}
          />
        </main>
      </div>
    </div>
  );
}
