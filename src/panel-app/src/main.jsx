import React from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "@arco-design/web-react";
import zhCN from "@arco-design/web-react/es/locale/zh-CN";
import App from "./App.jsx";
import "./styles.css";
import "@arco-design/web-react/dist/css/arco.css";

createRoot(document.getElementById("root")).render(
  <ConfigProvider locale={zhCN}>
    <App />
  </ConfigProvider>
);
