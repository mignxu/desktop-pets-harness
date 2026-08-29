const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("petAPI", {
  reportHit: (overSprite) => ipcRenderer.send("pet:hit-test", overSprite),
  sendMetrics: (metrics) => ipcRenderer.send("pet:metrics", metrics),
});
