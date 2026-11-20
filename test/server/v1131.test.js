// v1.13.1: YouTube in Spanish (its English titles were showing: "His photo with…"),
// and Podcasts' search finds channels (a search of videos gave 20 of one show).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, fakeYouTube } = require('../helpers');

const CHANNEL = 'UCBYyJBCtCvgqA4NwtoPMwpQ';

test('yt-dlp asks YouTube in Spanish; the channel search uses its "Canales" filter, still after "--"', async () => {
  const seen = [];
  const childProcess = require('child_process');
  const real = childProcess.execFile;
  childProcess.execFile = (bin, args, opts, cb) => {
    seen.push(args);
    cb(null, JSON.stringify({ _type: 'playlist', entries: [
      { id: CHANNEL, title: 'The Wild Project', channel_follower_count: 7520000, thumbnails: [{ url: '//yt3.ggpht.com/abc=s88', width: 88 }, { url: '//yt3.ggpht.com/abc=s176', width: 176 }] },
      { id: 'dQw4w9WgXcQ', title: 'a video, not a channel' },
    ] }));
  };
  try {
    delete require.cache[require.resolve('../../server/lib/ytdlp')];
    const fresh = require('../../server/lib/ytdlp');
    const found = await fresh.searchChannels('wild project\n--exec calc', { ytDlpPath: 'yt-dlp' }, 12);
    const args = seen[0];
    assert.deepEqual(args.slice(args.indexOf('--extractor-args'), args.indexOf('--extractor-args') + 2), ['--extractor-args', 'youtube:lang=es']);
    assert.equal(args.indexOf('--'), args.length - 2, 'the target last, after --');
    const target = new URL(args[args.length - 1]);
    assert.equal(target.origin + target.pathname, 'https://www.youtube.com/results');
    assert.equal(target.searchParams.get('search_query'), 'wild project --exec calc', 'one line, as words to search');
    assert.equal(target.searchParams.get('sp'), 'EgIQAg==', 'only channels');
    assert.deepEqual(found.map((c) => c.id), [CHANNEL], 'only channels come back');
    assert.equal(found[0].followers, 7520000);
    assert.equal(found[0].thumbnail, 'https://yt3.ggpht.com/abc=s176', 'its picture over https');

    await fresh.search('algo', { ytDlpPath: 'yt-dlp' }, 5);
    assert.ok(seen[1].includes('youtube:lang=es'), 'songs too, as their channel wrote them in Spanish');
  } finally {
    childProcess.execFile = real;
    delete require.cache[require.resolve('../../server/lib/ytdlp')];
  }
});

test('/api/podcasts/find: channels to follow, name and picture checked, a link the follow route takes', async () => {
  const yt = fakeYouTube({
    searchChannels: async (q) => {
      yt.calls.push(['searchChannels', q]);
      return [
        { id: CHANNEL, title: 'The Wild Project', thumbnail: 'https://yt3.ggpht.com/abc=s176', followers: 7520000 },
        { id: 'UCbYEEV6swi2yZWWuFop73LQ', title: 'Alaska Wild Project - Videos', thumbnail: 'https://yt3.googleusercontent.com/ytc/AI=s176', followers: null },
        { id: 'UCw5rtbEnGSNF7Tzke07lqHg', title: 'Evil picture', thumbnail: 'https://evil.example.com/a.jpg', followers: 1 },
      ];
    },
  });
  const app = await startApp({ yt });
  try {
    const r = await app.call('GET', '/api/podcasts/find?q=wild%20project');
    assert.equal(r.status, 200);
    const { shows } = r.data;
    assert.deepEqual(yt.calls.find((c) => c[0] === 'searchChannels'), ['searchChannels', 'wild project']);
    assert.deepEqual(shows[0], { url: `https://www.youtube.com/channel/${CHANNEL}`, name: 'The Wild Project', thumb: 'https://yt3.ggpht.com/abc=s176', followers: 7520000 });
    assert.equal(shows[1].name, 'Alaska Wild Project', 'the "- Videos" tab name trimmed');
    assert.equal(shows[1].thumb, 'https://yt3.googleusercontent.com/ytc/AI=s176');
    assert.equal(shows[2].thumb, null, 'a picture from anywhere else is dropped');
    const empty = await app.call('GET', '/api/podcasts/find?q=');
    assert.deepEqual(empty.data, { shows: [] });
    assert.equal((await app.call('GET', '/api/podcasts/find?q=x', { auth: false })).status, 401, 'the secret, as everywhere');
  } finally { await app.close(); }
});
