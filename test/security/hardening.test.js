// What CodeQL pointed at after the first push: saving files, decoding a
// title once, a limit on your own songs, and copying TubeGrab's data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeFileAtomic } = require('../../server/lib/atomic');
const { parseApple } = require('../../server/lib/importlist');
const { migrateFromTubeGrab } = require('../../server/lib/migrate');
const { startApp } = require('../helpers');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('saving: whole or not at all, a fresh random temporary file each time, nothing left behind', () => {
  const dir = tmp('rum-atomic-');
  try {
    const file = path.join(dir, 'likes.json');
    // Someone guessing the old fixed name ("<file>.tmp") gets nothing from it.
    fs.writeFileSync(`${file}.tmp`, 'planted');
    writeFileAtomic(file, '{"a":1}');
    writeFileAtomic(file, '{"a":2}');
    assert.equal(fs.readFileSync(file, 'utf8'), '{"a":2}');
    assert.equal(fs.readFileSync(`${file}.tmp`, 'utf8'), 'planted', 'the planted file is neither used nor followed');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['likes.json', 'likes.json.tmp'], 'no temporary files left');
    assert.throws(() => writeFileAtomic(path.join(dir, 'missing', 'x.json'), '{}'));
    assert.deepEqual(fs.readdirSync(dir).sort(), ['likes.json', 'likes.json.tmp'], 'nothing left after a failure either');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Apple Music titles: entities decoded once ("&amp;quot;" is the text "&quot;")', () => {
  const html = '<meta property="og:title" content="Rock &amp;quot;n&amp;quot; Roll &amp; Co &#39;24 on Apple Music">';
  assert.equal(parseApple(html).title, "Rock &quot;n&quot; Roll & Co '24");
});

test('your own songs: rate-limited like every other route', async () => {
  const app = await startApp();
  try {
    const r = await app.call('GET', '/api/local/file?id=nope');
    assert.equal(r.status, 404);
    assert.ok(r.headers.get('ratelimit') || r.headers.get('ratelimit-policy'), 'the limiter answers on this route');
  } finally { await app.close(); }
});

test('migration: a link planted in TubeGrab\'s folder is never followed, a file already here never replaced', () => {
  const from = tmp('rum-from-');
  const to = tmp('rum-to-');
  const outside = tmp('rum-outside-');
  try {
    fs.writeFileSync(path.join(outside, 'secret.json'), '{"secret":true}');
    let linked = true;
    try { fs.symlinkSync(path.join(outside, 'secret.json'), path.join(from, 'likes.json'), 'file'); } catch { linked = false; } // Windows without the right
    fs.writeFileSync(path.join(from, 'news.json'), '{"news":[]}');
    fs.writeFileSync(path.join(to, 'news.json'), '{"mine":true}');
    fs.writeFileSync(path.join(from, 'stream-lists.json'), '[]');
    assert.deepEqual(migrateFromTubeGrab(from, to), ['stream-lists.json']);
    if (linked) assert.equal(fs.existsSync(path.join(to, 'likes.json')), false, 'the link is skipped');
    assert.equal(fs.readFileSync(path.join(to, 'news.json'), 'utf8'), '{"mine":true}');
  } finally {
    for (const d of [from, to, outside]) fs.rmSync(d, { recursive: true, force: true });
  }
});
