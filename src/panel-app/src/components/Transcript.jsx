import React, { useEffect, useMemo, useRef } from "react";
import { Collapse, Skeleton, Spin } from "@arco-design/web-react";
import MdStream from "./MdStream.jsx";
import ToolCard from "./ToolCard.jsx";
import ApprovalCard from "./ApprovalCard.jsx";

const STATE_COLOR = { idle: "#00b42a", working: "#165dff", waitingInteraction: "#ff7d00", error: "#f53f3f" };

export default function Transcript({ entries, items, thread, loaded, focusSeq }) {
  const scrollRef = useRef(null);
  const stickRef = useRef(true);
  const approvalRefs = useRef(new Map());

  const resolutions = useMemo(() => {
    const map = {};
    for (const e of entries) if (e.type === "interaction.closed") map[e.interactionId] = e.resolution;
    return map;
  }, [entries]);

  // 滚动吸附:用户本就在底部时才跟随,往上翻历史不被拽回
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  // 召唤聚焦:滚到待审批卡并高亮
  useEffect(() => {
    if (!focusSeq) return;
    const hit = [...approvalRefs.current.entries()].find(([, el]) => el.querySelector?.(".btns"));
    if (hit) {
      const el = hit[1];
      el.scrollIntoView({ block: "center" });
      el.classList.add("flash");
    }
  }, [focusSeq]);

  if (!loaded) return <div id="transcript" ref={scrollRef} />;

  const blocks = [];
  if (!entries.length) {
    blocks.push(
      <div key="empty" style={{ height: "100%" }} />
    );
  } else {
    for (const e of entries) {
      if (e.__user) {
        blocks.push(
          <div key={`u${e.threadId}`} className="msg user">
            <div className="bubble">{e.text}</div>
          </div>
        );
        continue;
      }
      switch (e.type) {
        case "turn.started":
          blocks.push(<Divider key={`ts${e.threadId}`}>Turn 开始</Divider>);
          break;
        case "item.started": {
          const view = items[e.item.itemId];
          if (view) blocks.push(<ItemBlock key={view.itemId} view={view} />);
          break;
        }
        case "interaction.opened":
          blocks.push(
            <ApprovalCard
              key={e.interaction.interactionId}
              threadId={e.threadId}
              interaction={e.interaction}
              resolution={resolutions[e.interaction.interactionId]}
              innerRef={(el) => approvalRefs.current.set(e.interaction.interactionId, el)}
            />
          );
          break;
        case "turn.completed": {
          const o = e.outcome ?? {};
          if (o.status === "failed") {
            blocks.push(<Divider key="tc">{<span className="err">✖ Turn 失败:{o.usage?.error ?? o.result ?? ""}</span>}</Divider>);
          } else if (o.status === "cancelled") {
            blocks.push(<Divider key="tc">Turn 已停止</Divider>);
          } else {
            blocks.push(
              <Divider key="tc">
                {<span className="ok">✔ 完成</span>}
                {o.result ? " · " + String(o.result).slice(0, 120) : ""}
              </Divider>
            );
          }
          break;
        }
        case "turn.failed":
          blocks.push(<Divider key="tf">{<span className="err">✖ {e.error}</span>}</Divider>);
          break;
        // item.updated/completed、thread.meta、interaction.closed 由 view/resolution 覆盖
      }
    }
    // 流式加载态:turn 运行中但没有任何进行中的条目(等待首 token)
    if (thread?.state === "working") {
      const anyRunning = entries.some(
        (e) => e.type === "item.started" && items[e.item.itemId]?.status === "inProgress"
      );
      if (!anyRunning) {
        blocks.push(
          <div key="skeleton" className="item">
            <Skeleton text={{ rows: 2, width: ["60%", "80%"] }} animation />
          </div>
        );
      }
    }
  }

  return (
    <div id="transcript" ref={scrollRef} onScroll={onScroll}>
      <div id="transcript-inner">{blocks}</div>
    </div>
  );
}

function Divider({ children }) {
  return <div className="divider">{children}</div>;
}

function UserMsg({ text }) {
  return (
    <div className="msg user">
      <div className="bubble">{text}</div>
    </div>
  );
}

function ItemBlock({ view }) {
  const streaming = view.status === "inProgress";
  if (view.type === "agentMessage") {
    const text = (view.text ?? "").replace(/^\n+/, ""); // 思考→正文切换残留的空行不进正文
    if (streaming && !text) {
      return (
        <div className="msg agent">
          <div className="thinking-dots"><span /><span /><span /></div>
        </div>
      );
    }
    return (
      <div className="msg agent">
        <MdStream text={text} streaming={streaming} />
      </div>
    );
  }
  if (view.type === "reasoning") {
    return (
      <div className="item">
        <Collapse bordered={false} defaultActiveKey={streaming ? ["r"] : []}>
          <Collapse.Item name="r" header={
            <span className="reasoning-head">💭 思考过程 {streaming && <Spin size={12} style={{ marginLeft: 6 }} />}</span>
          }>
            <pre className="body">{view.text ?? ""}</pre>
          </Collapse.Item>
        </Collapse>
      </div>
    );
  }
  return <ToolCard view={view} />;
}
