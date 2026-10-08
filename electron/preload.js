// The only doors from the page to the desktop, each checked again in main.js.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('rumoria', {
  settings: () => ipcRenderer.invoke('rumoria:settings'),
  pickMusicDir: () => ipcRenderer.invoke('rumoria:pickMusicDir'),
  setCloseToTray: (on) => ipcRenderer.invoke('rumoria:setCloseToTray', on === true),
  downloadInTubeGrab: (id) => ipcRenderer.invoke('rumoria:downloadInTubeGrab', String(id)),
  // Global shortcuts: how they are, and a change ({ enabled?, keys?, reset? }; checked in shortcuts.js).
  shortcuts: {
    get: () => ipcRenderer.invoke('rumoria:shortcuts'),
    set: (patch) => ipcRenderer.invoke('rumoria:setShortcuts', patch),
  },
  // Updates: the state, news of it (returns a way to stop listening), look now, restart to update.
  update: {
    state: () => ipcRenderer.invoke('rumoria:update:state'),
    onState: (cb) => { const f = (_e, s) => cb(s); ipcRenderer.on('rumoria:update', f); return () => ipcRenderer.removeListener('rumoria:update', f); },
    check: () => ipcRenderer.send('rumoria:update:check'),
    restart: () => ipcRenderer.send('rumoria:update:restart'),
  },
  // Your look: the text size (the whole page zoomed, between 80 % and 150 %).
  look: {
    zoom: (f) => { const n = Number(f); if (Number.isFinite(n)) webFrame.setZoomFactor(Math.min(1.5, Math.max(0.8, n))); },
  },
  // The mini player: open it, tell it what's playing, its settings, and its buttons (returns a way to stop listening).
  mini: {
    open: () => ipcRenderer.send('rumoria:mini:open'),
    state: (s) => ipcRenderer.send('rumoria:player:state', s),
    prefs: () => ipcRenderer.invoke('rumoria:mini:prefs'),
    setPrefs: (patch) => ipcRenderer.invoke('rumoria:mini:setPrefs', patch),
    onCommand: (cb) => { const f = (_e, c) => cb(c); ipcRenderer.on('rumoria:player:command', f); return () => ipcRenderer.removeListener('rumoria:player:command', f); },
  },
});
