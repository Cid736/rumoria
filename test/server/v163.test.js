// v1.6.3: videos YouTube no longer serves (private, deleted…) never reach a
// list, a radio or Explorar — also in lists kept on disk from before.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isUnavailable } = require('../../server/lib/ytdlp');
const { Browse, songsOf } = require('../../server/lib/browse');
const { cleanTrack } = require('../../server/lib/streamlists');

const v = (id, title, extra = {}) => ({ id, title, channel: 'Canal', duration: 200, thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, ...extra });

test('unavailable: no title, "[Private video]", "[Deleted video]", members only; a playlist or a channel in a search never is', () => {
  for (const e of [v('aaaaaaaaaaa', ''), v('aaaaaaaaaaa', '[Private video]'), v('aaaaaaaaaaa', '[Deleted video]'), v('aaaaaaaaaaa', '[Vídeo privado]'), v('aaaaaaaaaaa', 'Canción', { availability: 'subscriber_only' })]) {
    assert.equal(isUnavailable(e), true, JSON.stringify(e));
  }
  assert.equal(isUnavailable(v('aaaaaaaaaaa', 'Una canción')), false);
  assert.equal(isUnavailable(v('aaaaaaaaaaa', 'Una canción', { availability: 'public' })), false);
  assert.equal(isUnavailable({ id: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', title: '' }), false, 'a playlist found by a search');
  assert.equal(isUnavailable(null), false);
});

test('Explorar: out of what YouTube answers, and out of the lists kept on disk at start', () => {
  assert.deepEqual(songsOf([v('aaaaaaaaaaa', 'Uno'), v('bbbbbbbbbbb', ''), v('ccccccccccc', '[Private video]', { duration: null, channel: null })]).map((s) => s.id), ['aaaaaaaaaaa']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rum-163-'));
  try {
    const file = path.join(dir, 'b.json');
    fs.writeFileSync(file, JSON.stringify({ chill: { at: Date.now(), tracks: [v('aaaaaaaaaaa', 'Uno'), v('bbbbbbbbbbb', ''), v('ccccccccccc', '[Deleted video]')] } }));
    const b = new Browse(file);
    assert.deepEqual(b.cache.chill.tracks.map((t) => t.id), ['aaaaaaaaaaa']);
    assert.deepEqual(b.list().find((l) => l.id === 'chill').thumbs, ['https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg'], 'the cover of four only from songs that play');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('your lists: "[Private video]" / "[Deleted video]" entries are dropped (also from lists kept from before)', () => {
  assert.equal(cleanTrack({ title: '[Private video]', yt: 'aaaaaaaaaaa' }), null);
  assert.equal(cleanTrack({ title: '[Deleted video]', artist: '' }), null);
  assert.equal(cleanTrack({ title: 'Private video', artist: 'A band' }).title, 'Private video', 'a real song called like that stays');
});

test('Explorar: a list kept from another search (an older version) is read again at once, and replaced', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rum-163b-'));
  try {
    const file = path.join(dir, 'b.json');
    const many = Array.from({ length: 30 }, (_, i) => v(`a${String(i).padStart(10, '0')}`, `Vieja ${i}`));
    fs.writeFileSync(file, JSON.stringify({ dormir: { at: Date.now(), q: 'sleep music', tracks: many } }));
    const b = new Browse(file);
    assert.equal(b.isFresh('dormir'), false, 'its search changed');
    const calls = [];
    const flatList = async (target) => { calls.push(target); return /results\?search_query/.test(target) ? { entries: [] } : { entries: [v('nnnnnnnnnnn', 'Nueva')] }; };
    const l = await b.get('dormir', flatList);
    assert.ok(calls.length > 0, 'asked YouTube again');
    assert.deepEqual(l.tracks.map((t) => t.title), ['Nueva'], 'the new one, even if shorter');
    assert.equal(b.isFresh('dormir'), true);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).dormir.q, 'calm songs to fall asleep');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
