import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 面板渲染层构建:src/panel-app → build/panel(Electron loadFile 加载,base 必须相对)
export default defineConfig({
  root: "src/panel-app",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../../build/panel",
    emptyOutDir: true,
  },
});
