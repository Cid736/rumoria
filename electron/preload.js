// The only doors from the page to the desktop: three, each checked again in main.js.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clmusic', {
  settings: () => ipcRenderer.invoke('clmusic:settings'),
  pickMusicDir: () => ipcRenderer.invoke('clmusic:pickMusicDir'),
  downloadInTubeGrab: (id) => ipcRenderer.invoke('clmusic:downloadInTubeGrab', String(id)),
});
