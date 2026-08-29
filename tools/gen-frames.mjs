// 生成宠物帧动画测试素材:24 帧 64x64 PNG(跳跃的果冻小球,带挤压拉伸与影子)。
// 零依赖:手写 PNG 编码器(node:zlib 压缩)。
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src", "pet", "frames");
mkdirSync(outDir, { recursive: true });

const W = 64, H = 64, SS = 2; // SS: 2x 超采样抗锯齿
const FRAMES = 24;

// ---- 最小 PNG 编码器 ----
const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ---- 帧绘制 ----
function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function drawFrame(t) {
  // t: 0..1 相位
  const hop = Math.sin(Math.PI * t); // 0→1→0 一次跳跃
  const squash = Math.sin(2 * Math.PI * t) * 0.18;
  const cx = 32;
  const cy = 40 - hop * 10;
  const rx = 17 * (1 + squash);
  const ry = 15 * (1 - squash);
  const shadowW = 14 + (1 - hop) * 6;
  const top = mix([255, 158, 187], [255, 138, 170], 0);
  const bottom = [235, 77, 128];
  const rgba = Buffer.alloc(W * H * 4);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 2x 超采样
      let cov = 0, shCov = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS + 0.5;
          const py = y + (sy + 0.5) / SS + 0.5;
          const dx = (px - cx) / rx, dy = (py - cy) / ry;
          if (dx * dx + dy * dy <= 1) cov++;
          const sdx = (px - cx) / shadowW, sdy = (py - 57) / 3;
          if (sdx * sdx + sdy * sdy <= 1 && py > cy + ry * 0.4) shCov++;
        }
      }
      const i = (y * W + x) * 4;
      if (cov === 0 && shCov === 0) {
        rgba[i + 3] = 0;
        continue;
      }
      let r = 0, g = 0, b = 0, a = 0;
      if (shCov) {
        r = 20; g = 24; b = 34; a = (shCov / (SS * SS)) * 0.30;
      }
      if (cov) {
        const grad = Math.min(1, Math.max(0, (y - (cy - ry)) / (2 * ry)));
        const [br, bg, bb] = mix(top, bottom, grad);
        const bodyA = cov / (SS * SS);
        // 身体覆盖在影子之上
        r = br; g = bg; b = bb; a = bodyA;
        // 高光
        const hx = x - (cx - 6), hy = y - (cy - ry * 0.45);
        if (hx * hx + hy * hy < 9 && cov) { r = 255; g = 214; b = 228; }
        // 眼睛(随相位轻微左右看)
        const look = Math.round(Math.sin(2 * Math.PI * t) * 1.5);
        const e1 = (x - (cx - 6 + look)) ** 2 + (y - (cy - 3)) ** 2;
        const e2 = (x - (cx + 6 + look)) ** 2 + (y - (cy - 3)) ** 2;
        if (e1 < 4 || e2 < 4) { r = 40; g = 42; b = 54; }
      }
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b;
      rgba[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  return encodePNG(W, H, rgba);
}

for (let n = 0; n < FRAMES; n++) {
  const file = join(outDir, `anim_${n}.png`);
  writeFileSync(file, drawFrame(n / FRAMES));
}
console.log(`generated ${FRAMES} frames -> ${outDir}`);
