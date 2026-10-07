// `npm run notices`: third-party/THIRD-PARTY-NOTICES.txt — every package that
// ships with the app (the server's production dependencies, and what Vite
// bundles into the page) with its license text. Run before each build.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const BUNDLED = ['react', 'react-dom', 'zustand']; // in dist/, not in node_modules of the app
const PERMISSIVE = /^(\(?(MIT|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|0BSD|Unlicense|CC0-1\.0|BlueOak-1\.0\.0)\)?( (OR|AND) )?)+$/;

const tree = JSON.parse(execSync('npm ls --omit=dev --all --json', { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const names = new Set();
// A package can appear first as a deduped entry without its own subtree (a
// peer, say): its dependencies are walked the first time they're listed.
const expanded = new Set();
const walk = (deps) => {
  for (const [n, d] of Object.entries(deps || {})) {
    names.add(n);
    if (d.dependencies && !expanded.has(n)) { expanded.add(n); walk(d.dependencies); }
  }
};
walk(tree.dependencies);
const pkg = (n) => JSON.parse(fs.readFileSync(path.join(root, 'node_modules', n, 'package.json'), 'utf8'));
const addWithDeps = (n) => { if (names.has(n)) return; names.add(n); for (const d of Object.keys(pkg(n).dependencies || {})) addWithDeps(d); };
BUNDLED.forEach(addWithDeps);

const out = ['Rumoria — third-party notices', '', 'Rumoria includes the following open-source packages, each under its own license.', ''];
const problems = [];
for (const n of [...names].sort()) {
  const p = pkg(n);
  const lic = typeof p.license === 'string' ? p.license : 'UNKNOWN';
  if (!PERMISSIVE.test(lic)) problems.push(`${n}: ${lic}`);
  const dir = path.join(root, 'node_modules', n);
  const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f));
  out.push('-'.repeat(72), `${n} ${p.version} — ${lic}`, '-'.repeat(72));
  out.push(file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : `${lic} license${p.author ? `, ${typeof p.author === 'string' ? p.author : p.author.name}` : ''}.`, '');
}
fs.mkdirSync(path.join(root, 'third-party'), { recursive: true });
fs.writeFileSync(path.join(root, 'third-party', 'THIRD-PARTY-NOTICES.txt'), out.join('\n'));
console.log(`${names.size} packages → third-party/THIRD-PARTY-NOTICES.txt`);
if (problems.length) { console.error(`Licenses to review: ${problems.join('; ')}`); process.exit(1); }
