// `npm run dev`: the local server (with a secret made for this run) and Vite,
// which proxies /api to it adding the secret. Open http://127.0.0.1:5173.
// The desktop-only bits (music folder picker, "Descargar con TubeGrab") are
// hidden in a plain browser.
const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');

const token = crypto.randomBytes(32).toString('hex');
const port = process.env.CLMUSIC_DEV_PORT || '5174';
const root = path.join(__dirname, '..');
const env = { ...process.env, CLMUSIC_TOKEN: token, CLMUSIC_DEV_TOKEN: token, CLMUSIC_PORT: port, CLMUSIC_DEV_PORT: port };

const server = spawn(process.execPath, [path.join(root, 'server', 'main.js')], { env, stdio: 'inherit' });
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')], { env, stdio: 'inherit', cwd: root });
const stop = () => { server.kill(); vite.kill(); process.exit(0); };
process.on('SIGINT', stop);
server.on('exit', stop);
vite.on('exit', stop);
