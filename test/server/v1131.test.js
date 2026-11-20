// v1.13.1: YouTube in Spanish (its English titles were showing: "His photo with…"),
// and Podcasts' search finds channels and playlists (a search of videos gave 20 of one show).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, fakeYouTube } = require('../helpers');

const CHANNEL = 'UCBYyJBCtCvgqA4NwtoPMwpQ';
const LIST = 'PLzuFY9Ixj9Z6nf7z6t5YmPDTLBgksk8Ts';

function withFakeYtDlp(entries, run) {
  const seen = [];
  const childProcess = require('child_process');
  const real = childProcess.execFile;
  childProcess.execFile = (bin, args, opts, cb) => { seen.push(args); cb(null, JSON.stringify({ _type: 'playlist', entries })); };
  delete require.cache[require.resolve('../../server/lib/ytdlp')];
  const fresh = require('../../server/lib/ytdlp');
  return run(fresh, seen).finally(() => {
    childProcess.execFile = real;
    delete require.cache[require.resolve('../../server/lib/ytdlp')];
  });
}

const target = (args) => new URL(args[args.length - 1]);

test('yt-dlp asks YouTube in Spanish; channels with its "Canales" filter, still after "--"', () => withFakeYtDlp([
  { id: CHANNEL, title: 'The Wild Project', channel_follower_count: 7520000, thumbnails: [{ url: '//yt3.ggpht.com/abc=s88', width: 88 }, { url: '//yt3.ggpht.com/abc=s176', width: 176 }] },
  { id: 'dQw4w9WgXcQ', title: 'a video, not a channel' },
], async (fresh, seen) => {
  const found = await fresh.searchShows('wild project\n--exec calc', { ytDlpPath: 'yt-dlp' }, 'channel', 12);
  const args = seen[0];
  assert.deepEqual(args.slice(args.indexOf('--extractor-args'), args.indexOf('--extractor-args') + 2), ['--extractor-args', 'youtube:lang=es']);
  assert.equal(args.indexOf('--'), args.length - 2, 'the target last, after --');
  assert.equal(target(args).origin + target(args).pathname, 'https://www.youtube.com/results');
  assert.equal(target(args).searchParams.get('search_query'), 'wild project --exec calc', 'one line, as words to search');
  assert.equal(target(args).searchParams.get('sp'), 'EgIQAg==', 'only channels');
  assert.deepEqual(found.map((c) => c.id), [CHANNEL]);
  assert.equal(found[0].followers, 7520000);
  assert.equal(found[0].thumbnail, 'https://yt3.ggpht.com/abc=s176', 'its picture over https');
  await fresh.search('algo', { ytDlpPath: 'yt-dlp' }, 5);
  assert.ok(seen[1].includes('youtube:lang=es'), 'songs too, as their channel wrote them in Spanish');
  await assert.rejects(fresh.searchShows('x', { ytDlpPath: 'yt-dlp' }, 'evil'));
}));

test('playlists: their own filter; the channel YouTube puts first, mixes and your own lists left out', () => withFakeYtDlp([
  { id: CHANNEL, title: 'The Wild Project' },
  { id: LIST, title: 'THE WILD PROJECT PODCAST', channel: 'The Wild Project', thumbnails: [{ url: 'https://i.ytimg.com/vi/mStOFBvToUI/hq720.jpg?sqp=x', width: 720 }] },
  { id: 'RDaaaaaaaaaaaaa', title: 'Mix' },
  { id: 'LLaaaaaaaaaaaaa', title: 'Me gusta' },
], async (fresh, seen) => {
  const found = await fresh.searchShows('wild project', { ytDlpPath: 'yt-dlp' }, 'playlist', 8);
  assert.equal(target(seen[0]).searchParams.get('sp'), 'EgIQAw==');
  assert.deepEqual(found.map((l) => l.id), [LIST]);
  assert.equal(found[0].channel, 'The Wild Project');
}));

test('/api/podcasts/find: a channel, then a list, in turn; names and pictures checked; links the follow route takes', async () => {
  const yt = fakeYouTube({
    searchShows: async (q, env, kind) => {
      yt.calls.push(['searchShows', q, kind]);
      return kind === 'channel'
        ? [
          { id: CHANNEL, title: 'The Wild Project', thumbnail: 'https://yt3.ggpht.com/abc=s176', followers: 7520000 },
          { id: 'UCbYEEV6swi2yZWWuFop73LQ', title: 'Alaska Wild Project - Videos', thumbnail: 'https://yt3.googleusercontent.com/ytc/AI=s176', followers: null },
          { id: 'UCw5rtbEnGSNF7Tzke07lqHg', title: 'Evil picture', thumbnail: 'https://evil.example.com/a.jpg', followers: 1 },
        ]
        : [{ id: LIST, title: 'THE WILD PROJECT PODCAST', channel: 'The Wild Project', thumbnail: 'https://i.ytimg.com/vi/mStOFBvToUI/hq720.jpg?sqp=x' }];
    },
  });
  const app = await startApp({ yt });
  try {
    const r = await app.call('GET', '/api/podcasts/find?q=wild%20project');
    assert.equal(r.status, 200);
    const { shows } = r.data;
    assert.deepEqual(yt.calls.filter((c) => c[0] === 'searchShows').map((c) => c[2]).sort(), ['channel', 'playlist']);
    assert.deepEqual(shows.map((s) => s.kind), ['channel', 'playlist', 'channel', 'channel'], 'one of each in turn');
    assert.deepEqual(shows[0], { kind: 'channel', id: `ch:${CHANNEL}`, url: `https://www.youtube.com/channel/${CHANNEL}`, name: 'The Wild Project', thumb: 'https://yt3.ggpht.com/abc=s176', followers: 7520000 });
    assert.deepEqual(shows[1], { kind: 'playlist', id: `pl:${LIST}`, url: `https://www.youtube.com/playlist?list=${LIST}`, name: 'THE WILD PROJECT PODCAST', thumb: 'https://i.ytimg.com/vi/mStOFBvToUI/hq720.jpg?sqp=x', by: 'The Wild Project' });
    assert.equal(shows[2].name, 'Alaska Wild Project', 'the "- Videos" tab name trimmed');
    assert.equal(shows[2].thumb, 'https://yt3.googleusercontent.com/ytc/AI=s176');
    assert.equal(shows[3].thumb, null, 'a picture from anywhere else is dropped');
    assert.deepEqual((await app.call('GET', '/api/podcasts/find?q=')).data, { shows: [] });
    assert.equal((await app.call('GET', '/api/podcasts/find?q=x', { auth: false })).status, 401, 'the secret, as everywhere');
  } finally { await app.close(); }
});

test('/api/podcasts/find: one search failing still gives the other; both failing is an error', async () => {
  let fail = 'playlist';
  const yt = fakeYouTube({ searchShows: async (q, env, kind) => (kind === fail || fail === 'both' ? null : [{ id: CHANNEL, title: 'The Wild Project', thumbnail: null, followers: 1 }]) });
  const app = await startApp({ yt });
  try {
    assert.deepEqual((await app.call('GET', '/api/podcasts/find?q=w')).data.shows.map((s) => s.kind), ['channel']);
    fail = 'both';
    assert.equal((await app.call('GET', '/api/podcasts/find?q=w')).status, 502);
  } finally { await app.close(); }
});

test('v1.13.2: an exact show name YouTube reads as nothing is searched again with "podcast"', async () => {
  const asked = [];
  const yt = fakeYouTube({ searchShows: async (q, env, kind) => { asked.push([q, kind]); return /podcast$/.test(q) && kind === 'channel' ? [{ id: CHANNEL, title: 'La Pija y la Quinqui', thumbnail: null, followers: 1 }] : []; } });
  const app = await startApp({ yt });
  try {
    const r = await app.call('GET', '/api/podcasts/find?q=la%20pija%20y%20la%20quinqui');
    assert.deepEqual(r.data.shows.map((s) => [s.id, s.name]), [[`ch:${CHANNEL}`, 'La Pija y la Quinqui']]);
    assert.deepEqual(asked.map((a) => a[0]), ['la pija y la quinqui', 'la pija y la quinqui', 'la pija y la quinqui podcast', 'la pija y la quinqui podcast']);
    asked.length = 0;
    await app.call('GET', '/api/podcasts/find?q=mi%20podcast');
    assert.equal(asked.length, 2, 'not again when "podcast" was already there');
  } finally { await app.close(); }
});

test('v1.13.2: a show\'s page before following it; "Seguir" right after reads YouTube no more', async () => {
  const yt = fakeYouTube();
  let reads = 0;
  yt.flatList = async () => { reads += 1; return { title: 'THE WILD PROJECT PODCAST', entries: [{ id: 'aaaaaaaaaaa', title: 'Episodio 1', duration: 5400, channel: 'The Wild Project' }] }; };
  const app = await startApp({ yt });
  try {
    const url = `https://www.youtube.com/playlist?list=${LIST}`;
    const r = await app.call('GET', `/api/podcasts/preview?url=${encodeURIComponent(url)}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.show, { id: `pl:${LIST}`, url, name: 'THE WILD PROJECT PODCAST', thumb: 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg' });
    assert.equal(r.data.episodes[0].title, 'Episodio 1');
    assert.equal((await app.call('GET', '/api/podcasts')).data.shows.length, 0, 'looking is not following');
    const f = await app.call('POST', '/api/podcasts', { body: { url } });
    assert.equal(f.status, 200);
    assert.equal(f.data.show.id, `pl:${LIST}`);
    assert.equal(reads, 1, 'its episodes were already read');
    assert.equal((await app.call('GET', `/api/podcasts/preview?url=${encodeURIComponent('https://evil.example.com/playlist?list=PLaaaaaaaaaa')}`)).status, 400, 'only YouTube');
    assert.equal((await app.call('GET', `/api/podcasts/preview?url=${encodeURIComponent('https://www.youtube.com/watch?v=aaaaaaaaaaa')}`)).status, 400, 'a video is not a show');
  } finally { await app.close(); }
});
