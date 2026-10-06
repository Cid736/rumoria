// Where songs come from: Spotify / Apple Music pages, LRCLIB lyrics, your
// music folder, yt-dlp's arguments, and the data copied from TubeGrab.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const importlist = require('../../server/lib/importlist');
const lyrics = require('../../server/lib/lyrics');
const { parseLrc } = require('../../server/lib/lrc');
const { LocalMusic, nameParts, isInside } = require('../../server/lib/localmusic');
const ytdlp = require('../../server/lib/ytdlp');
const { migrateFromTubeGrab } = require('../../server/lib/migrate');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'esc-src-'));

function fakeFetch(routes, seen = []) {
  return async (url, init) => {
    const u = new URL(url);
    seen.push({ host: u.host, path: u.pathname, params: Object.fromEntries(u.searchParams), ua: init.headers['User-Agent'], redirect: init.redirect });
    const r = routes[u.pathname] || { status: 404, body: '' };
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status || 200 });
  };
}

test('spotify profile: only open.spotify.com/user/<id> links', () => {
  assert.deepEqual(importlist.parseProfileUrl('https://open.spotify.com/user/abc.def_1?si=x'), { id: 'abc.def_1', url: 'https://open.spotify.com/user/abc.def_1' });
  for (const bad of ['http://open.spotify.com/user/x', 'https://evil.com/user/x', 'https://open.spotify.com.evil.com/user/x', 'https://open.spotify.com/user/../x',
    'https://u:p@open.spotify.com/user/x', 'https://open.spotify.com:8443/user/x', 'javascript:alert(1)', '', null]) {
    assert.equal(importlist.parseProfileUrl(bad), null, String(bad));
  }
  assert.equal(importlist.isImportUrl('https://open.spotify.com/user/x'), false, 'a profile is not a playlist');
});

test('spotify profile: read through the page (no lists → a clear error)', async () => {
  let asked = null;
  const page = `<script id="initialState">${JSON.stringify({ entities: { items: { 'spotify:user:pepe': { name: 'Pepe', publicPlaylistsV2: { totalCount: 1, items: [{ _uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M', data: { name: 'Una' } }] } } } } })}</script>`;
  const r = await importlist.readProfile('https://open.spotify.com/user/pepe', { fetchText: async (url) => { asked = url; return page; } });
  assert.equal(asked, 'https://open.spotify.com/user/pepe');
  assert.equal(r.playlists.length, 1);
  await assert.rejects(importlist.readProfile('https://open.spotify.com/user/pepe', { fetchText: async () => '<html></html>' }), /ninguna lista pública/);
});

test('lyrics: asks only lrclib.net, over HTTPS, as Escuchar, no redirects', async () => {
  const seen = [];
  const found = await lyrics.findLyrics({ artist: 'Queen', title: 'Bohemian Rhapsody (Official Video)', duration: 354.6 },
    { fetchImpl: fakeFetch({ '/api/get': { body: { plainLyrics: 'Is this the real life?', syncedLyrics: '[00:00.15] Is this the real life?' } } }, seen) });
  assert.deepEqual(found, { plain: 'Is this the real life?', synced: '[00:00.15] Is this the real life?' });
  assert.equal(seen[0].host, 'lrclib.net');
  assert.match(seen[0].ua, /^Escuchar\//);
  assert.equal(seen[0].redirect, 'error');
  await assert.rejects(lyrics.findLyrics({ artist: 'A', title: 'B' }, { fetchImpl: fakeFetch({ '/api/get': { body: 'x'.repeat(600 * 1024) } }) }), /demasiado grande/);
});

test('lyrics: LRC lines → times in seconds, in order, without control characters', () => {
  assert.deepEqual(parseLrc('[00:02.50] dos\n[00:01.00] uno\u0007\nbasura\n[01:00][01:30] estribillo'), [
    { t: 1, text: 'uno' }, { t: 2.5, text: 'dos' }, { t: 60, text: 'estribillo' }, { t: 90, text: 'estribillo' },
  ]);
});

test('yt-dlp: only YouTube links; the search text can never become an option', () => {
  assert.equal(ytdlp.youTubeUrl('youtube.com/playlist?list=PL1'), 'https://youtube.com/playlist?list=PL1');
  assert.equal(ytdlp.youTubeUrl('http://music.youtube.com/playlist?list=x'), 'https://music.youtube.com/playlist?list=x');
  for (const bad of ['https://evil.com/?youtube.com', 'https://youtube.com.evil.com/x', 'https://u:p@youtube.com/x', 'https://youtube.com:8080/x', 'file:///etc/passwd', 'javascript:alert(1)', '']) {
    assert.equal(ytdlp.youTubeUrl(bad), null, bad);
  }
});

test('yt-dlp: the arguments end with "--" before anything typed', async () => {
  const seen = [];
  const childProcess = require('child_process');
  const real = childProcess.execFile;
  childProcess.execFile = (bin, args, opts, cb) => { seen.push(args); cb(null, JSON.stringify({ _type: 'playlist', entries: [{ id: 'dQw4w9WgXcQ', title: 'x' }] })); };
  try {
    // A fresh copy of the module that picks up the fake.
    delete require.cache[require.resolve('../../server/lib/ytdlp')];
    const fresh = require('../../server/lib/ytdlp');
    const r = await fresh.search('--exec "calc.exe"\n--output x', { ytDlpPath: 'yt-dlp' }, 5);
    assert.equal(r.length, 1);
    const args = seen[0];
    const dd = args.indexOf('--');
    assert.ok(dd > 0 && dd === args.length - 2, 'the target is the last argument, after --');
    assert.equal(args[dd + 1], 'ytsearch5:--exec "calc.exe" --output x', 'one line, as a search');
    assert.ok(args.includes('default,-generic'), 'no generic extractor');
  } finally {
    childProcess.execFile = real;
    delete require.cache[require.resolve('../../server/lib/ytdlp')];
  }
});

test('your music: audio files only, by id, never outside the folder', () => {
  const dir = tmp();
  const outside = tmp();
  try {
    fs.mkdirSync(path.join(dir, 'Rock'));
    fs.writeFileSync(path.join(dir, 'Rock', 'Queen - Bohemian Rhapsody.mp3'), 'x');
    fs.writeFileSync(path.join(dir, '01 - Intro.flac'), 'x');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    fs.writeFileSync(path.join(dir, '.hidden.mp3'), 'x');
    fs.writeFileSync(path.join(outside, 'secret.mp3'), 'x');
    const lm = new LocalMusic(dir);
    const songs = lm.scan();
    assert.deepEqual(songs.map((s) => s.rel).sort(), ['01 - Intro.flac', 'Rock/Queen - Bohemian Rhapsody.mp3']);
    const q = songs.find((s) => s.rel.startsWith('Rock'));
    assert.equal(q.key, 'f:Rock/Queen - Bohemian Rhapsody.mp3', 'the same key TubeGrab used');
    assert.deepEqual([q.artist, q.title], ['Queen', 'Bohemian Rhapsody']);
    assert.equal(lm.resolve(q.id).mime, 'audio/mpeg');
    for (const bad of ['../secret', '', 'x'.repeat(32), null, '../../etc/passwd']) assert.equal(lm.resolve(bad), null, String(bad));
    // A file that moved away after the scan is not served.
    fs.rmSync(path.join(dir, 'Rock', 'Queen - Bohemian Rhapsody.mp3'));
    assert.equal(lm.resolve(q.id), null);
    assert.equal(new LocalMusic('relative/path').scan().length, 0, 'only absolute folders');
    assert.deepEqual(nameParts('03. Song.mp3'), { artist: '', title: 'Song' });
    const root = path.join(os.tmpdir(), 'a');
    assert.equal(isInside(root, path.join(root, 'b.mp3')), true);
    assert.equal(isInside(root, path.join(`${root}b`, 'b.mp3')), false, 'a sibling whose name starts the same');
    assert.equal(isInside(root, root), false);
    assert.equal(isInside(root, path.join(root, '..', 'x.mp3')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('migration: TubeGrab\'s files copied once, never overwriting, only valid JSON', () => {
  const from = tmp();
  const to = tmp();
  try {
    fs.writeFileSync(path.join(from, 'stream-lists.json'), '[]');
    fs.writeFileSync(path.join(from, 'likes.json'), '{broken');
    fs.writeFileSync(path.join(from, 'news.json'), '{"news":[]}');
    fs.writeFileSync(path.join(to, 'news.json'), '{"mine":true}');
    fs.writeFileSync(path.join(from, 'settings.json'), '{}');
    assert.deepEqual(migrateFromTubeGrab(from, to), ['stream-lists.json']);
    assert.equal(fs.readFileSync(path.join(to, 'news.json'), 'utf8'), '{"mine":true}', 'never overwritten');
    assert.equal(fs.existsSync(path.join(to, 'likes.json')), false, 'broken: skipped');
    assert.equal(fs.existsSync(path.join(to, 'settings.json')), false, 'only the listening files');
    fs.writeFileSync(path.join(from, 'listen-history.json'), '{}');
    assert.deepEqual(migrateFromTubeGrab(from, to), [], 'only once');
    assert.deepEqual(migrateFromTubeGrab('relative', to), []);
  } finally {
    fs.rmSync(from, { recursive: true, force: true });
    fs.rmSync(to, { recursive: true, force: true });
  }
});
