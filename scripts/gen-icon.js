// 用宠物精灵帧生成应用图标 build/icon.png(供 electron-builder 使用,参考 ToDoList)
// 纯 Node 实现(pngjs),不依赖 electron 运行时,避免本机 electron 二进制启动异常导致脚本崩溃
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const SRC = path.join(__dirname, "..", "小呆", "action", "stand_00.png");
const OUT = path.join(__dirname, "..", "build", "icon.png");
const SIZE = 256;

// 最近邻缩放(图标尺寸小,最近邻足够;实现简单且无外部依赖)
function nearestResize(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
      const si = (sy * sw + sx) * 4;
      const di = (y * dw + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return out;
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error("找不到宠物帧:", SRC);
    process.exit(1);
  }
  const png = PNG.sync.read(fs.readFileSync(SRC));
  const scale = SIZE / Math.max(png.width, png.height);
  const dw = Math.max(1, Math.round(png.width * scale));
  const dh = Math.max(1, Math.round(png.height * scale));
  const resized = nearestResize(png.data, png.width, png.height, dw, dh);

  const out = new PNG({ width: SIZE, height: SIZE });
  out.data.fill(0); // 透明底
  const offX = Math.floor((SIZE - dw) / 2);
  const offY = Math.floor((SIZE - dh) / 2);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const si = (y * dw + x) * 4;
      const di = ((offY + y) * SIZE + (offX + x)) * 4;
      out.data[di] = resized[si];
      out.data[di + 1] = resized[si + 1];
      out.data[di + 2] = resized[si + 2];
      out.data[di + 3] = resized[si + 3];
    }
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, PNG.sync.write(out));
  console.log("图标已生成:", OUT, `(${dw}x${dh} 居中于 ${SIZE}x${SIZE})`);
}

main();
