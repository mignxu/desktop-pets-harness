import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 面板渲染层构建:src/panel-app → panel-dist(Electron loadFile 加载,base 必须相对)
// 注意:产物目录刻意避开 electron-builder 保留名 build/dist,否则会被自动 !build 剪枝、面板打不进包
export default defineConfig({
  root: "src/panel-app",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../../panel-dist",
    emptyOutDir: true,
  },
});
