// The mini window's only doors to the desktop: what's playing, its settings,
// its buttons, moving it. Each is checked again in mini.js (who sends, what).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mini', {
  onState: (cb) => ipcRenderer.on('mini:state', (_e, s) => cb(s)),
  onPrefs: (cb) => ipcRenderer.on('mini:prefs', (_e, p) => cb(p)),
  setPrefs: (patch) => ipcRenderer.invoke('rumoria:mini:setPrefs', patch),
  command: (cmd, value) => ipcRenderer.send('mini:command', String(cmd), value === undefined ? undefined : Number(value)),
  move: (dx, dy) => ipcRenderer.send('mini:move', Number(dx), Number(dy)),
  hover: (on) => ipcRenderer.send('mini:hover', on === true),
  close: () => ipcRenderer.send('mini:close'),
  showMain: () => ipcRenderer.send('mini:showMain'),
});
