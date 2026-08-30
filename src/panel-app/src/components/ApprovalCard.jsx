import React from "react";
import { respond } from "../api.js";

export default function ApprovalCard({ threadId, interaction, resolution, innerRef }) {
  const decided = resolution !== undefined;
  return (
    <div className="item">
      <div ref={innerRef} className="card approval" data-interaction={interaction.interactionId}>
        <div className="head">
          <span className="st inProgress" style={{ background: "var(--warning)" }} />
          <b>⚠ 审批 · {interaction.toolName}</b>
        </div>
        <div className="mono">{interaction.summary}</div>
        <details>
          <summary>完整参数</summary>
          <pre>{JSON.stringify(interaction.detail ?? {}, null, 2)}</pre>
        </details>
        {decided ? (
          <div className="resolved">{resolution === "allowed" ? "✔ 已允许" : "✖ 已拒绝"}</div>
        ) : (
          <div className="btns">
            <button className="allow" onClick={() => respond(threadId, interaction.interactionId, "allow")}>
              允许本次
            </button>
            <button className="deny" onClick={() => respond(threadId, interaction.interactionId, "deny")}>
              拒绝
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
