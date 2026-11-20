// v1.13, Podcasts: following a channel or a playlist, its episodes (no Shorts),
// and where you left each one, all checked as carefully as anything from outside.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Podcasts, showOf, showName, cleanEpisode, cleanNotes } = require('../../server/lib/podcasts');
const { startApp, fakeYouTube } = require('../helpers');

const ep = (id, title, duration = 2400) => ({ id, title, duration, channel: 'Ondas Lentas', thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
const EPISODES = [ep('aaaaaaaaaaa', 'Episodio 2'), ep('bbbbbbbbbbb', 'Un Short', 40), ep('ccccccccccc', 'Episodio 1')];

test('a link → the show it is: channels (id or @handle) and playlists, nothing else', () => {
  assert.deepEqual(showOf('https://www.youtube.com/@ondaslentas'), { id: 'ch:@ondaslentas', url: 'https://www.youtube.com/@ondaslentas' });
  assert.deepEqual(showOf('https://www.youtube.com/@ondaslentas/videos'), { id: 'ch:@ondaslentas', url: 'https://www.youtube.com/@ondaslentas' });
  assert.equal(showOf('https://www.youtube.com/channel/UC1234567890123456789012').id, 'ch:UC1234567890123456789012');
  assert.deepEqual(showOf('https://www.youtube.com/watch?v=aaaaaaaaaaa&list=PLabcdefghij'), { id: 'pl:PLabcdefghij', url: 'https://www.youtube.com/playlist?list=PLabcdefghij' });
  assert.equal(showOf('https://www.youtube.com/watch?v=aaaaaaaaaaa&list=RDaaaaaaaaaaa'), null, 'a mix is not a show');
  assert.equal(showOf('https://www.youtube.com/watch?v=aaaaaaaaaaa'), null);
  assert.equal(showOf('https://www.youtube.com/@x/../../etc'), null);
  assert.equal(showName('Ondas Lentas - Videos'), 'Ondas Lentas');
  assert.equal(cleanEpisode(ep('bbbbbbbbbbb', 'Short', 40)), null, 'Shorts are not episodes');
  assert.equal(cleanEpisode(ep('bbbbbbbbbbb', 'A 3-minute clip', 180)), null, 'nor clips cut from one');
  assert.equal(cleanEpisode({ id: 'x', title: 'bad id' }), null);
  assert.equal(cleanEpisode({ id: 'aaaaaaaaaaa', title: 'Evil cover', thumbnail: 'https://evil.example.com/a.jpg' }).thumbnail, 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg');
});

test('an episode\'s notes: its lines kept, control characters out, capped', () => {
  assert.equal(cleanNotes('Hoy:\r\n\u0007el ruido\n\n\n\nde la ciudad  \n'), 'Hoy:\n el ruido\n\nde la ciudad');
  assert.equal(cleanNotes(null), '');
  assert.equal(cleanNotes('x'.repeat(9000)).length, 5000);
});

test('progress: kept, the last minute counts as heard, and read back field by field', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rum-pod-'));
  const file = path.join(dir, 'podcasts.json');
  try {
    const p = new Podcasts(file, { now: () => 1000 });
    assert.equal(p.setProgress('aaaaaaaaaaa', { t: 600, d: 2400, title: 'Uno', show: 'ch:@ondas' }).done, false);
    assert.equal(p.setProgress('aaaaaaaaaaa', { t: 2350, d: 2400 }).done, true, 'the outro counts');
    assert.equal(p.progress.aaaaaaaaaaa.title, 'Uno', 'what it knew stays');
    assert.equal(p.setProgress('nope', { t: 1 }), null);
    assert.equal(p.setProgress('ccccccccccc', { t: -5 }), null);
    // Tampered file: bad entries are dropped.
    fs.writeFileSync(file, JSON.stringify({ shows: [{ id: 'ch:@ok-show', name: 'Ok', url: 'https://www.youtube.com/@ok-show' }, { id: 'evil', name: 'x', url: 'https://evil.example.com' }], progress: { aaaaaaaaaaa: { t: 5, d: 10, thumb: 'javascript:alert(1)' }, '../x': { t: 1 } } }));
    const back = new Podcasts(file);
    assert.deepEqual(back.shows.map((s) => s.id), ['ch:@ok-show']);
    assert.deepEqual(Object.keys(back.progress), ['aaaaaaaaaaa']);
    assert.equal(back.progress.aaaaaaaaaaa.thumb, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the server: follow by link, episodes, progress, unfollow', async () => {
  const yt = fakeYouTube({ latestEntries: async (url) => { yt.calls.push(['latest', url]); return { title: 'Ondas Lentas - Videos', entries: EPISODES }; } });
  const app = await startApp({ yt });
  try {
    const bad = await app.call('POST', '/api/podcasts', { body: { url: 'https://evil.example.com/@x' } });
    assert.equal(bad.status, 400);
    const r = await app.call('POST', '/api/podcasts', { body: { url: 'youtube.com/@ondaslentas' } });
    assert.equal(r.status, 200);
    assert.equal(r.data.show.id, 'ch:@ondaslentas');
    assert.equal(r.data.show.name, 'Ondas Lentas');
    assert.deepEqual(r.data.episodes.map((e) => e.yt), ['aaaaaaaaaaa', 'ccccccccccc']);
    // Cached: no second yt-dlp run.
    const runs = yt.calls.filter((c) => c[0] === 'latest').length;
    const eps = await app.call('GET', `/api/podcasts/${encodeURIComponent('ch:@ondaslentas')}/episodes`);
    assert.equal(eps.data.episodes.length, 2);
    assert.equal(yt.calls.filter((c) => c[0] === 'latest').length, runs);
    assert.equal((await app.call('GET', `/api/podcasts/${encodeURIComponent('ch:@other')}/episodes`)).status, 404);

    const saved = await app.call('POST', '/api/podcasts/progress', { body: { yt: 'aaaaaaaaaaa', t: 900, d: 2400, title: 'Episodio 2', show: 'ch:@ondaslentas' } });
    assert.equal(saved.data.t, 900);
    const all = await app.call('GET', '/api/podcasts');
    assert.equal(all.data.shows.length, 1);
    assert.equal(all.data.progress.aaaaaaaaaaa.t, 900);
    assert.equal((await app.call('POST', '/api/podcasts/progress', { body: { yt: 'x', t: 1 } })).status, 400);
    assert.equal((await app.call('POST', '/api/podcasts/progress/remove', { body: { yt: 'aaaaaaaaaaa' } })).data.ok, true);

    assert.equal((await app.call('DELETE', `/api/podcasts/${encodeURIComponent('ch:@ondaslentas')}`)).data.ok, true);
    assert.equal((await app.call('GET', '/api/podcasts')).data.shows.length, 0);
    // Writes need the app's header like every other change.
    assert.equal((await app.call('POST', '/api/podcasts', { body: { url: 'youtube.com/@x' }, headers: { 'X-Rumoria': null } })).status, 403);
  } finally { await app.close(); }
});

test('an episode\'s notes: asked for by id only, cleaned, kept after the first time', async () => {
  const asked = [];
  const yt = fakeYouTube({ description: async (id) => { asked.push(id); return 'Hoy:\r\nel ruido\n\n\n\nde la ciudad'; } });
  const app = await startApp({ yt });
  try {
    const bad = await app.call('GET', '/api/podcasts/notes/abc');
    assert.equal(bad.status, 400);
    const r = await app.call('GET', '/api/podcasts/notes/aaaaaaaaaaa');
    assert.equal(r.status, 200);
    assert.equal(r.data.notes, 'Hoy:\nel ruido\n\nde la ciudad');
    await app.call('GET', '/api/podcasts/notes/aaaaaaaaaaa');
    assert.deepEqual(asked, ['aaaaaaaaaaa']);
    const noAuth = await app.call('GET', '/api/podcasts/notes/aaaaaaaaaaa', { auth: false });
    assert.equal(noAuth.status, 401);
  } finally { await app.close(); }
});
