import React, { useEffect, useRef, useState } from "react";
import Md from "./Md.jsx";

// 打字机平滑:LLM 的 delta 常整块到达(Codex Desktop 观感的关键就是这里),
// 内部用 rAF 把已到达文本按加速速率逐字"放"出来——追得上、不卡顿。
export default function MdStream({ text, streaming }) {
  const [revealed, setRevealed] = useState(0);
  const revealedRef = useRef(0);

  useEffect(() => {
    if (revealedRef.current > text.length) {
      // 目标变短(新消息/重置)直接对齐
      revealedRef.current = text.length;
      setRevealed(text.length);
      return;
    }
    if (!streaming || revealedRef.current >= text.length) return;
    let raf;
    const tick = () => {
      const remaining = text.length - revealedRef.current;
      if (remaining <= 0) return;
      // 积压越多步长越大:既能追平突发大块,又保持逐字观感
      const step = Math.max(2, Math.ceil(remaining / 18));
      revealedRef.current = Math.min(text.length, revealedRef.current + step);
      setRevealed(revealedRef.current);
      if (revealedRef.current < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, streaming]);

  const shown = streaming ? text.slice(0, revealed) : text;
  return (
    <div className="md">
      <Md text={shown} />
      {streaming && <span className="cursor" />}
    </div>
  );
}
