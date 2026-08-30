import React, { useRef } from "react";
import { Message } from "@arco-design/web-react";
import { startTurn, stopTurn } from "../api.js";

export default function Composer({ activeThreadId, active, busy }) {
  const [text, setText] = React.useState("");
  const ref = useRef(null);
  const cwdName = active?.cwd ? active.cwd.split(/[\\/]/).filter(Boolean).pop() : "窝";

  const submit = async () => {
    const value = text.trim();
    if (!value || !activeThreadId || busy) return;
    setText("");
    const res = await startTurn(activeThreadId, value);
    if (res && res.ok === false) Message.error(res.error || "发送失败");
  };

  return (
    <div id="composer-wrap">
      <div id="composer">
        <textarea
          id="input"
          ref={ref}
          rows={1}
          placeholder="让宠物干点什么…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(140, e.target.scrollHeight) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="actions">
          <span className="tool-chip locked" title="对话绑定 harness,不可中途切换(铁律)">🐾 Claude Code</span>
          <div className="spacer" />
          <span className="tool-chip" title="模型(SDK 默认或 api-config)">{active?.model ?? "model"} ⌄</span>
          <span className="tool-chip" title="权限模式:harness 原生默认档">🛡 默认审批 ⌄</span>
          {busy ? (
            <button id="stop" title="停止" onClick={() => stopTurn()}>⏹</button>
          ) : (
            <button id="send" title="发送" onClick={submit}>↑</button>
          )}
        </div>
      </div>
      <div className="below-row">
        <span className="chip">📁 {cwdName} ⌄</span>
      </div>
    </div>
  );
}
