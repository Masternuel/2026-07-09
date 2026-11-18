const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bolaDesktop", Object.freeze({
  readAiSettings: () => ipcRenderer.invoke("desktop:readAiSettings"),
  writeAiSettings: (value) => ipcRenderer.invoke("desktop:writeAiSettings", value),
  testAiConnection: () => ipcRenderer.invoke("desktop:testAiConnection"),
  session: () => ipcRenderer.invoke("desktop:session"),
  updateProfile: (name) => ipcRenderer.invoke("desktop:updateProfile", name),
  readPreferences: () => ipcRenderer.invoke("desktop:readPreferences"),
  writePreferences: (value) => ipcRenderer.invoke("desktop:writePreferences", value),
  catalogStatus: () => ipcRenderer.invoke("desktop:catalogStatus"),
  catalogOpenBrowser: (origin) => ipcRenderer.invoke("desktop:catalogOpenBrowser", origin),
  catalogPreview: () => ipcRenderer.invoke("desktop:catalogPreview"),
  catalogCancel: (id) => ipcRenderer.invoke("desktop:catalogCancel", id),
  catalogCommit: (id) => ipcRenderer.invoke("desktop:catalogCommit", id),
  peerStatus: () => ipcRenderer.invoke("desktop:peerStatus"),
  peerCreateOffer: (roomCode) => ipcRenderer.invoke("desktop:peerCreateOffer", roomCode),
  peerAcceptAnswer: (answer) => ipcRenderer.invoke("desktop:peerAcceptAnswer", answer),
  peerCreateAnswer: (offer) => ipcRenderer.invoke("desktop:peerCreateAnswer", offer),
  peerEnterGuest: () => ipcRenderer.invoke("desktop:peerEnterGuest"),
  peerDisconnect: () => ipcRenderer.invoke("desktop:peerDisconnect"),
}));
