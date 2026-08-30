export const snapshot = () => window.panelAPI.snapshot();
export const createThread = () => window.panelAPI.createThread();
export const startTurn = (threadId, text) => window.panelAPI.startTurn(threadId, text);
export const stopTurn = () => window.panelAPI.stopTurn();
export const respond = (threadId, interactionId, behavior) =>
  window.panelAPI.respond(threadId, interactionId, behavior);
export const windowAction = (action) => window.panelAPI.windowAction(action);
