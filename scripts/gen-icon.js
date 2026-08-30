// 用宠物精灵帧生成应用图标 build/icon.png(供 electron-builder 使用,参考 ToDoList)
const { app, nativeImage } = require("electron");
const fs = require("fs");
const path = require("path");

app.whenReady().then(() => {
  const frame = path.join(__dirname, "..", "小呆", "action", "stand_00.png");
  const img = nativeImage.createFromPath(frame);
  if (img.isEmpty()) {
    console.error("无法读取精灵帧:", frame);
    app.exit(1);
    return;
  }
  const icon = img.resize({ width: 256, height: 256, quality: "best" });
  const out = path.join(__dirname, "..", "build", "icon.png");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, icon.toPNG());
  console.log("图标已生成:", out);
  app.quit();
});
