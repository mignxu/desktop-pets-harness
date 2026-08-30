import React from "react";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function renderDiff(diffText) {
  return diffText
    .split(/\r?\n/)
    .map((line) => {
      const cls = line.startsWith("+") && !line.startsWith("+++") ? "add"
        : line.startsWith("-") && !line.startsWith("---") ? "del"
        : line.startsWith("@@") ? "hunk" : "line";
      return `<span class="line ${cls}">${esc(line) || " "}</span>`;
    })
    .join("");
}

export default function ToolCard({ view }) {
  const inProgress = view.status === "inProgress";
  const stClass = view.status ?? "inProgress";
  if (view.type === "commandExecution") {
    return (
      <div className="item">
        <div className="card">
          <div className="head"><span className={`st ${stClass}`} /><b>⌘ 命令执行</b>{inProgress && <span className="elapsed">运行中…</span>}</div>
          <div className="mono cmd">$ {view.command ?? ""}</div>
          <details open={view.output === undefined}>
            <summary>输出</summary>
            <pre className="out">{view.output ?? "(运行中…)"}</pre>
          </details>
        </div>
      </div>
    );
  }
  if (view.type === "fileChange") {
    return (
      <div className="item">
        <div className="card">
          <div className="head"><span className={`st ${stClass}`} /><b>✎ 文件修改</b><span className="mono path">{view.path ?? ""}</span></div>
          {view.unifiedDiff ? <pre className="diff" dangerouslySetInnerHTML={{ __html: renderDiff(view.unifiedDiff) }} /> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="item">
      <div className="card">
        <div className="head"><span className={`st ${stClass}`} /><b>🔧 {view.toolName ?? "工具"}</b></div>
        <details><summary>参数</summary><pre>{JSON.stringify(view.arguments ?? {}, null, 2)}</pre></details>
        <details open={view.output === undefined}>
          <summary>输出</summary>
          <pre className="out">{view.output ?? "(运行中…)"}</pre>
        </details>
      </div>
    </div>
  );
}
