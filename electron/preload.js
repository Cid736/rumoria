// The only doors from the page to the desktop: three, each checked again in main.js.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rumoria', {
  settings: () => ipcRenderer.invoke('rumoria:settings'),
  pickMusicDir: () => ipcRenderer.invoke('rumoria:pickMusicDir'),
  downloadInTubeGrab: (id) => ipcRenderer.invoke('rumoria:downloadInTubeGrab', String(id)),
});
