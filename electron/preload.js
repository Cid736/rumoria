// The only doors from the page to the desktop, each checked again in main.js.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rumoria', {
  settings: () => ipcRenderer.invoke('rumoria:settings'),
  pickMusicDir: () => ipcRenderer.invoke('rumoria:pickMusicDir'),
  downloadInTubeGrab: (id) => ipcRenderer.invoke('rumoria:downloadInTubeGrab', String(id)),
  // Updates: the state, news of it (returns a way to stop listening), look now, restart to update.
  update: {
    state: () => ipcRenderer.invoke('rumoria:update:state'),
    onState: (cb) => { const f = (_e, s) => cb(s); ipcRenderer.on('rumoria:update', f); return () => ipcRenderer.removeListener('rumoria:update', f); },
    check: () => ipcRenderer.send('rumoria:update:check'),
    restart: () => ipcRenderer.send('rumoria:update:restart'),
  },
});
