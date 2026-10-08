// The mini player: what it may show, what its buttons may ask, its settings,
// and that every message is checked for who sent it.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const fs = require('fs');
const path = require('path');

const realLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'electron') return { BrowserWindow: function BrowserWindow() {}, ipcMain: { on() {}, handle() {} }, screen: {} };
  return realLoad.call(this, request, ...rest);
};
const { cleanPrefs, cleanState, cleanCommand } = require('../../electron/mini');
Module._load = realLoad;

const root = path.join(__dirname, '..', '..');

test('mini: what it shows is text and a YouTube cover only', () => {
  const s = cleanState({ title: 'A\u0000<b>x</b>', artist: 'B', cover: 'https://i.ytimg.com/vi/abc/hqdefault.jpg?sqp=x&rs=y', playing: true, time: 50, duration: 200, liked: 'yes', repeat: 'evil', volume: 9 });
  assert.equal(s.title, 'A <b>x</b>', 'control characters out; shown with textContent anyway');
  assert.equal(s.cover, 'https://i.ytimg.com/vi/abc/hqdefault.jpg?sqp=x&rs=y');
  assert.equal(s.liked, false);
  assert.equal(s.repeat, 'off');
  assert.equal(s.volume, 1);
  for (const cover of ['https://evil.example/a.jpg', 'javascript:alert(1)', 'file:///C:/x.jpg', 'http://i.ytimg.com/vi/a/b.jpg', '/api/lists']) assert.equal(cleanState({ cover }).cover, null, cover);
  assert.equal(cleanState(null), null);
});

test('mini: its buttons can only ask for known things, with sane values', () => {
  assert.deepEqual(cleanCommand('toggle'), { cmd: 'toggle' });
  assert.deepEqual(cleanCommand('seek', 30), { cmd: 'seek', value: 30 });
  assert.equal(cleanCommand('seek', -1), null);
  assert.equal(cleanCommand('seek', 'x'), null);
  assert.deepEqual(cleanCommand('volume', 7), { cmd: 'volume', value: 1 });
  for (const bad of ['eval', 'openExternal', 'downloadInTubeGrab', '__proto__', '']) assert.equal(cleanCommand(bad), null, bad);
});

test('mini: settings within bounds', () => {
  assert.deepEqual(cleanPrefs(null), { compact: false, opacity: 1, hoverFull: true, onTop: true, locked: false, showCover: true, video: false, lyrics: true, card: false });
  assert.equal(cleanPrefs({ opacity: 0 }).opacity, 0.3, 'never invisible');
  assert.equal(cleanPrefs({ opacity: 5 }).opacity, 1);
  assert.equal(cleanPrefs({ compact: 'yes' }).compact, false);
});

test('mini: its window is locked down and every message checks who sent it', () => {
  const src = fs.readFileSync(path.join(root, 'electron', 'mini.js'), 'utf8');
  for (const must of ['contextIsolation: true', 'sandbox: true', 'nodeIntegration: false', "action: 'deny'", "'will-navigate'", "'will-attach-webview'"]) assert.ok(src.includes(must), must);
  // Each handler's first statement checks the sender.
  const starts = [...src.matchAll(/ipcMain\.(on|handle)\(/g)].map((m) => m.index);
  assert.ok(starts.length >= 9);
  for (const at of starts) {
    const head = src.slice(at, at + 200).split('\n').slice(0, 2).join('\n');
    assert.ok(/(if \(!?|\(\s*)(fromMini\(event\)|fromMain\(event\))/.test(head), head);
  }
  // The mini page: text only (no innerHTML), no inline code.
  const page = fs.readFileSync(path.join(root, 'public', 'mini.js'), 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/.test(page));
  const html = fs.readFileSync(path.join(root, 'public', 'mini.html'), 'utf8');
  assert.ok(!/<script>|\son[a-z]+=|\sstyle=/.test(html), 'no inline script, handlers or styles (the CSP forbids them)');
  const pre = fs.readFileSync(path.join(root, 'electron', 'mini-preload.js'), 'utf8');
  assert.ok(!/exposeInMainWorld\([^)]*ipcRenderer\s*[,)]/.test(pre));
  assert.ok([...pre.matchAll(/ipcRenderer\.(?:invoke|send|on)\(\s*'([^']+)'/g)].every((m) => /^(mini:|rumoria:mini:)/.test(m[1])));
});

test('mini v3: jump only to a sane place in the queue, mute; the next five songs as text only', () => {
  assert.deepEqual(cleanCommand('jump', 4), { cmd: 'jump', value: 4 });
  for (const bad of [-1, 1.5, 'x', 1e9]) assert.equal(cleanCommand('jump', bad), null, String(bad));
  assert.deepEqual(cleanCommand('mute'), { cmd: 'mute' });
  assert.equal(cleanCommand('volumeStep', 1), null, 'only the desktop shell sends that one');
  const s = cleanState({ title: 'x', muted: 'yes', queue: [{ i: 3, title: 'A\u0000b', artist: 'C' }, { i: -2, title: 'bad' }, { i: 'x' }, null, ...Array(10).fill({ i: 9, title: 't' })] });
  assert.equal(s.muted, false);
  assert.deepEqual(s.queue[0], { i: 3, title: 'A b', artist: 'C' });
  assert.ok(s.queue.length <= 5);
  assert.ok(s.queue.every((q) => Number.isInteger(q.i) && q.i >= 0));
  assert.deepEqual(cleanState({ title: 'x', queue: 'evil' }).queue, []);
});
