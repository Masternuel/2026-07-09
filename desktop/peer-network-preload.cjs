const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("peerNetwork", Object.freeze({
  onCommand(callback) { ipcRenderer.on("peer:command", (_event, command) => callback(command)); },
  result: (value) => ipcRenderer.send("peer:result", value),
  message: (value) => ipcRenderer.send("peer:message", value),
  closed: (id) => ipcRenderer.send("peer:closed", id),
}));
