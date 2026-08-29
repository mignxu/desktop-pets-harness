const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("panelAPI", {
  snapshot: () => ipcRenderer.invoke("panel:snapshot"),
  startTurn: (text) => ipcRenderer.invoke("turn:start", { text }),
  stopTurn: () => ipcRenderer.invoke("turn:stop"),
  respond: (threadId, interactionId, behavior) =>
    ipcRenderer.invoke("interaction:respond", { threadId, interactionId, behavior }),
  windowAction: (action) => ipcRenderer.send("panel:window", action),
  onEvent: (cb) => ipcRenderer.on("contract:event", (_e, event) => cb(event)),
  onFocusThread: (cb) => ipcRenderer.on("panel:focus-thread", (_e, threadId) => cb(threadId)),
});
