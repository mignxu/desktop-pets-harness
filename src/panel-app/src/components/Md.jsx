import React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function Md({ text }) {
  return (
    <div className="md">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  );
}
