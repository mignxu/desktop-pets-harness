import React from "react";
import { aggregateState } from "../store.js";

const STATE_COLOR = {
  idle: "#00b42a",
  working: "#165dff",
  waitingInteraction: "#ff7d00",
  error: "#f53f3f",
};

export default function Sider({ state, activeThreadId, onSelect, onNew }) {
  const agg = aggregateState(state.threads);
  const active = state.threads.find((t) => t.threadId === activeThreadId) ?? null;
  const usage = active?.usage;

  React.useEffect(() => {
    document.title =
      agg === "idle" ? "桌宠壳" : agg === "waitingInteraction" ? "桌宠壳 · 等你处理" : "桌宠壳 · 干活中";
  }, [agg]);

  return (
    <aside id="sidebar">
      <div className="sider-toolbar">
        <div className="row-btn" id="new-thread" style={{ flex: 1, padding: "0 8px 0 10px" }} onClick={onNew}>
          <span className="chip22">+</span>
          <span className="lbl">新对话</span>
        </div>
        <div className="icon-btn" title="批量管理(逻辑后加)">☑</div>
      </div>
      <div className="row-btn nav-entry" title="逻辑后加">
        <span className="chip22 ghost">🤖</span>
        <span className="lbl">助手</span>
      </div>
      <div className="row-btn nav-entry" title="逻辑后加">
        <span className="chip22 ghost">⏰</span>
        <span className="lbl">定时任务</span>
      </div>
      <div className="sider-divider" />
      <div id="sider-scroll">
        <div className="section-label">工作区</div>
        <div className="row-btn ws-row" title="全局宠物 · 无头工作区">
          <span className="chip22">📁</span>
          <span className="lbl">窝</span>
          <span className="ws-add" title="在工作区内新建对话" onClick={onNew}>+</span>
        </div>
        <div id="ws-threads">
          {state.threads.map((t) => (
            <div
              key={t.threadId}
              className={`row-btn conv${t.threadId === activeThreadId ? " active" : ""}`}
              title={t.harnessId === "claude-code" ? "Claude Code(对话绑定 harness,铁律)" : t.harnessId}
              onClick={() => onSelect(t.threadId)}
            >
              <span className="conv-icon">🐾</span>
              <span className="lbl">{t.title}</span>
              {t.pending ? <span className="t-badge">{t.pending}</span> : null}
              {t.state !== "idle" ? (
                <span className="run-dot" style={{ background: STATE_COLOR[t.state] }} />
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <div className="sider-footer">
        <div className="side-foot">
          <div className="row"><span>模型</span><span className="mono">{active?.model ?? "-"}</span></div>
          <div className="row">
            <span>输入 / 输出</span>
            <span className="mono">{(usage?.inputTokens ?? 0).toLocaleString()} / {(usage?.outputTokens ?? 0).toLocaleString()}</span>
          </div>
          <div className="row"><span>费用</span><span className="mono">{usage?.costUsd != null ? `$${usage.costUsd.toFixed(4)}` : "-"}</span></div>
          <CtxBar tokens={usage?.inputTokens ?? 0} />
        </div>
        <div className="row-btn" title="主题切换(逻辑后加)">
          <span className="chip22 ghost">🌓</span>
          <span className="lbl">主题</span>
        </div>
        <div className="row-btn" title="设置(逻辑后加)">
          <span className="chip22 ghost">⚙</span>
          <span className="lbl">设置</span>
        </div>
      </div>
    </aside>
  );
}

function CtxBar({ tokens }) {
  const pct = Math.min(100, Math.round((tokens / 200_000) * 100));
  const color = pct > 80 ? "var(--danger)" : pct > 55 ? "var(--warning)" : "var(--success)";
  return (
    <>
      <div className="ctx-bar"><div style={{ width: `${pct}%`, background: color }} /></div>
      <div className="row"><span>上下文占用</span><span className="mono">{pct}%</span></div>
    </>
  );
}
