// v0 Spike B/D 渲染层:帧动画(24 帧 @24fps)+ rAF 帧率实测 + 分区点击穿透
const FRAME_COUNT = 24;
const TARGET_FPS = 24;
const sprite = document.getElementById("sprite");
const osd = document.getElementById("osd");

const frames = [];
let loaded = 0;
for (let n = 0; n < FRAME_COUNT; n++) {
  const img = new Image();
  img.onload = () => { loaded += 1; };
  img.src = `./frames/anim_${n}.png`;
  frames.push(img);
}
sprite.src = frames[0].src;

let frameIndex = 0;
let lastSwap = performance.now();
let lastRaf = performance.now();
let rafFrames = 0, rafFps = 0, swapCount = 0;
let lastTick = performance.now();
let tickOver25 = 0, tickOver40 = 0;

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
