// `npm run android:build` (after android:prepare): Gradle's signed release
// build. Gradle's wrapper by its own path (gradlew.bat on Windows): with
// NoDefaultCurrentDirectoryInExePath set, cmd won't run a bare `gradlew`
// from the folder it's in.
const { spawnSync } = require('child_process');
const path = require('path');

const dir = path.join(__dirname, '..', 'android');
const win = process.platform === 'win32';
const wrapper = path.join(dir, win ? 'gradlew.bat' : 'gradlew');
// A .bat runs through cmd; the path is ours, nothing from outside goes in.
const r = spawnSync(wrapper, ['assembleRelease'], { cwd: dir, stdio: 'inherit', shell: win });
if (r.error) { console.error(r.error.message); process.exit(1); }
process.exit(r.status === null ? 1 : r.status);
