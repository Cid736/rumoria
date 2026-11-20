// v1.13: starting sooner on mobile data. One yt-dlp run gives the usual and a
// light address, the addresses survive a restart until they expire (only
// YouTube's media servers, read back as carefully as anything from outside),
// the relay honours `q=lite`, and /api/find looks the address up at once.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const stream = require('../../server/lib/stream');
const { startApp, VIDEO } = require('../helpers');

const ID = 'dQw4w9WgXcQ';
const gv = (itag, expire = Math.floor(Date.now() / 1000) + 6 * 3600) => `https://rr1---sn-abc.googlevideo.com/videoplayback?itag=${itag}&expire=${expire}`;
const fmt = (format_id, abr, ext, extra = {}) => ({ format_id, abr, ext, vcodec: 'none', acodec: ext === 'webm' ? 'opus' : 'mp4a.40.2', protocol: 'https', url: gv(format_id), ...extra });

test('one run, two addresses: the light one is the lowest bitrate of the original language, never a -drc or a dub', () => {
  const formats = [
    fmt('249', 50, 'webm', { language_preference: -1 }), // a dubbed track: lighter, but not the song's language
    fmt('249-drc', 51, 'webm', { language_preference: 10 }),
    fmt('250', 68, 'webm', { language_preference: 10 }),
    fmt('251', 130, 'webm', { language_preference: 10 }),
    fmt('140', 129, 'm4a', { language_preference: 10 }),
    { format_id: '18', vcodec: 'avc1', acodec: 'mp4a', abr: 96, url: gv('18') },
    fmt('evil', 20, 'webm', { url: 'https://evil.example.com/a', language_preference: 10 }),
  ];
  const info = stream._parseInfo(ID, JSON.stringify({ title: 'A - B', channel: 'A', duration: 200, requested_formats: [formats[4]], formats }), 'audio');
  assert.match(info.url, /itag=140/);
  assert.equal(info.mime, 'audio/mp4');
  assert.match(info.lite.url, /itag=250/);
  assert.equal(info.lite.mime, 'audio/webm');
  assert.equal(info.lite.abr, 68);
  // Nothing clearly lighter (or only the same one): no light address.
  assert.equal(stream._liteFormat([fmt('140', 129, 'm4a')], fmt('140', 129, 'm4a')), null);
  assert.equal(stream._liteFormat([fmt('251', 120, 'webm')], fmt('140', 129, 'm4a')), null);
  assert.equal(stream._liteFormat([fmt('x', 30, 'webm')], fmt('140', 129, 'm4a')), null, 'never below 40 kb/s');
  // The clip never gets one.
  assert.equal(stream._parseInfo(ID, JSON.stringify({ title: 'x', requested_formats: [{ ...formats[5], ext: 'mp4' }], formats }), 'video').lite, null);
});

test('an address is kept until 20 min before YouTube says it expires (four hours when it doesn\'t say)', () => {
  const now = 1_700_000_000_000;
  assert.equal(stream._keepUntil(`https://x.googlevideo.com/v?expire=${now / 1000 + 6 * 3600}`, now), now + 6 * 3600_000 - 20 * 60_000);
  assert.equal(stream._keepUntil('https://x.googlevideo.com/v', now), now + 4 * 3600_000);
  assert.equal(stream._keepUntil(`https://x.googlevideo.com/v?expire=${now / 1000 - 10}`, now), now + 4 * 3600_000);
  assert.equal(stream._keepUntil(`https://x.googlevideo.com/v?expire=${now / 1000 + 48 * 3600}`, now), now + 6 * 3600_000, 'never more than six hours');
});

test('addresses on disk: the valid ones come back, anything else (other hosts, bad ids, expired) is dropped', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rum-v113-'));
  const file = path.join(dir, 'stream-cache.json');
  const until = Date.now() + 3600_000;
  const good = { url: gv('140'), mime: 'audio/mp4', headers: { 'User-Agent': 'x', Cookie: 'no' }, lite: { url: gv('250'), mime: 'audio/webm', abr: 68 }, title: 'T', channel: 'C', artist: 'A', track: 'T', duration: 200, thumbnail: 'https://i.ytimg.com/vi/x/hq.jpg', chapters: [{ start: 0, end: 10, title: 'Uno' }, { start: 10, end: 20, title: 'Dos' }] };
  fs.writeFileSync(file, JSON.stringify({ v: 1, items: [
    ['AAAAAAAAAAA', until, good],
    ['BBBBBBBBBBB', until, { ...good, url: 'https://evil.example.com/a' }],
    ['../../etc/xx', until, good],
    ['CCCCCCCCCCC', Date.now() - 1, good],
    ['DDDDDDDDDDD', until, { ...good, lite: { url: 'http://rr1.googlevideo.com/a', mime: 'audio/webm' }, thumbnail: 'https://evil.example.com/x.jpg' }],
  ] }));
  try {
    stream.persist(file);
    const a = await stream.resolve('AAAAAAAAAAA', { ytDlpPath: 'C:/does/not/exist.exe' });
    assert.equal(a.url, good.url, 'served from disk, no yt-dlp');
    assert.deepEqual(a.headers, { 'User-Agent': 'x' }, 'only the headers the media server needs');
    assert.equal(a.lite.url, good.lite.url);
    assert.equal(a.chapters.length, 2);
    assert.equal(stream._cache.has('BBBBBBBBBBB'), false);
    assert.equal(stream._cache.has('../../etc/xx'), false);
    assert.equal(stream._cache.has('CCCCCCCCCCC'), false);
    const d = stream._cache.get('DDDDDDDDDDD').info;
    assert.equal(d.lite, null, 'a light address that isn\'t https on YouTube\'s servers is dropped');
    assert.equal(d.thumbnail, null);
    // Forgetting writes it back without that song.
    stream.forget('AAAAAAAAAAA');
    await new Promise((r) => setTimeout(r, 2300));
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.v, 1);
    assert.ok(!saved.items.some(([k]) => k === 'AAAAAAAAAAA'));
    assert.ok(saved.items.some(([k]) => k === 'DDDDDDDDDDD'));
  } finally {
    for (const k of ['AAAAAAAAAAA', 'DDDDDDDDDDD']) stream._cache.delete(k);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('routes: q=lite reaches the relay (audio only), and /api/find looks the address up at once', async () => {
  const calls = [];
  const yt = require('../helpers').fakeYouTube();
  yt.stream.prepare = (id) => { calls.push(['prepare', id]); return true; };
  const pipe = yt.stream.pipe;
  yt.stream.pipe = async (id, env, req, res, opts) => { calls.push(['pipe', opts.kind, opts.quality]); return pipe(id, env, req, res); };
  const app = await startApp({ yt });
  try {
    await app.call('GET', `/api/stream/audio?id=${VIDEO}&q=lite`, { raw: true }).then((r) => r.text());
    await app.call('GET', `/api/stream/audio?id=${VIDEO}&q=<x>`, { raw: true }).then((r) => r.text());
    await app.call('GET', `/api/stream/video?id=${VIDEO}&q=lite`, { raw: true }).then((r) => r.text());
    assert.deepEqual(calls.filter((c) => c[0] === 'pipe').map((c) => [c[1], c[2]]), [['audio', 'lite'], ['audio', 'normal'], ['video', 'normal']]);
    const found = await app.call('GET', `/api/find?q=${encodeURIComponent('X - A')}&d=200`);
    assert.equal(found.status, 200, JSON.stringify(found.data));
    assert.ok(calls.some((c) => c[0] === 'prepare' && c[1] === found.data.id), 'looked up as soon as it was found');
  } finally { await app.close(); }
});
