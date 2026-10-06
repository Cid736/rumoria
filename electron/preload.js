// The only doors from the page to the desktop: three, each checked again in main.js.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('escuchar', {
  settings: () => ipcRenderer.invoke('escuchar:settings'),
  pickMusicDir: () => ipcRenderer.invoke('escuchar:pickMusicDir'),
  downloadInTubeGrab: (id) => ipcRenderer.invoke('escuchar:downloadInTubeGrab', String(id)),
});
