// Spike B:帧动画(24 帧 @24fps)+ rAF 帧率实测
// Spike D:指针悬停精灵→可点击;悬停透明区→点击穿透(forward 模式)
const FRAME_COUNT = 24;
const TARGET_FPS = 24;
const sprite = document.getElementById("sprite");
const osd = document.getElementById("osd");
const stage = document.getElementById("stage");

const frames = [];
let loaded = 0;
for (let n = 0; n < FRAME_COUNT; n++) {
  const img = new Image();
  img.onload = () => { loaded += 1; };
  img.src = `./frames/anim_${n}.png`;
  frames.push(img);
}
sprite.src = frames[0].src;

// ---- 帧动画:rAF 驱动 + 固定步进 ----
let frameIndex = 0;
let lastSwap = performance.now();
let lastRaf = performance.now();
let rafFrames = 0, rafFps = 0, swapCount = 0;
let lastTick = performance.now();
let tickOver25 = 0, tickOver40 = 0; // 瞬时长帧:<40fps / <25fps 各计一次

function tick(now) {
  const tickDelta = now - lastTick;
  lastTick = now;
  if (tickDelta > 25) tickOver25 += 1;
  if (tickDelta > 40) tickOver40 += 1;

  rafFrames += 1;
  const rafDelta = now - lastRaf;
  if (rafDelta >= 1000) {
    rafFps = Math.round((rafFrames * 1000) / rafDelta);
    rafFrames = 0;
    lastRaf = now;
  }
  if (now - lastSwap >= 1000 / TARGET_FPS) {
    frameIndex = (frameIndex + 1) % FRAME_COUNT;
    const next = frames[frameIndex];
    if (next.complete && next.naturalWidth > 0) sprite.src = next.src;
    swapCount += 1;
    lastSwap = now;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---- 指标上报(自测模式由主进程收集)----
setInterval(() => {
  const metrics = {
    rafFps,
    targetFps: TARGET_FPS,
    swapCount,
    tickOver25,
    tickOver40,
    framesLoaded: `${loaded}/${FRAME_COUNT}`,
    hitToggles: window.__hitToggles ?? 0,
  };
  window.petAPI?.sendMetrics(metrics);
  osd.textContent =
    `FPS ${rafFps} (target 60)\n` +
    `anim ${TARGET_FPS}f/s · swaps ${swapCount}\n` +
    `>25ms ${tickOver25} · >40ms ${tickOver40}\n` +
    `img ${metrics.framesLoaded} · hit ${metrics.hitToggles}`;
}, 500);

// ---- Spike D:分区点击穿透 ----
// 精灵区域 = 36..164 x 40..168(128px 2x 放大居中)。spike 用矩形判定;
// 精确到像素 alpha 的 hit-test 是后续优化项。
const SPRITE = { x: 36, y: 40, w: 128, h: 128 };
let lastHit = null;
window.__hitToggles = 0;
window.addEventListener("mousemove", (event) => {
  const over =
    event.clientX >= SPRITE.x && event.clientX <= SPRITE.x + SPRITE.w &&
    event.clientY >= SPRITE.y && event.clientY <= SPRITE.y + SPRITE.h;
  if (over !== lastHit) {
    lastHit = over;
    window.__hitToggles += 1;
    window.petAPI?.reportHit(over);
  }
});
window.addEventListener("mouseleave", () => {
  if (lastHit !== false) {
    lastHit = false;
    window.petAPI?.reportHit(false);
  }
});
sprite.addEventListener("mousedown", () => { osd.textContent += "\n[poked!]"; });
