const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("petAPI", {
  // 渲染 → 主
  reportHit: (overUi) => ipcRenderer.send("pet:hit-test", overUi),
  dragStart: () => ipcRenderer.send("pet:drag-start"),
  dragMove: (screenX, screenY) => ipcRenderer.send("pet:drag-move", { screenX, screenY }),
  dragEnd: () => ipcRenderer.send("pet:drag-end"),
  poke: () => ipcRenderer.send("pet:poke"),
  bubbleOpen: (threadId) => ipcRenderer.send("bubble:open", threadId),
  setZoom: (zoom) => ipcRenderer.send("pet:set-zoom", zoom),
  // 主 → 渲染
  onConfig: (cb) => ipcRenderer.once("pet:config", (_e, cfg) => cb(cfg)),
  onState: (cb) => ipcRenderer.on("pet:state", (_e, payload) => cb(payload)),
});
