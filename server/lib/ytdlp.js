// yt-dlp, only for what a music app needs: searching YouTube, reading a
// playlist or a channel's newest uploads (flat: titles and ids, nothing is
// downloaded). Every run gets its target after `--`, so nothing typed can
// ever be read as an option, and the generic extractor is off, so a link can
// never make yt-dlp fetch an arbitrary host.
const { execFile } = require('child_process');

const YT_HOSTS = ['youtube.com', 'youtu.be', 'music.youtube.com'];
const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const UTF8 = ['--encoding', 'utf-8'];

/** A YouTube link, cleaned (https, no user/port), or null for anything else. */
function youTubeUrl(raw) {
  let value = String(raw || '').trim();
  if (!value || value.length > 2048) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!YT_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))) return null;
  url.protocol = 'https:';
  return url.toString();
}

const httpsThumb = (e) => {
  const list = Array.isArray(e.thumbnails) ? e.thumbnails : [];
  const pick = list.filter((t) => t && typeof t.url === 'string' && t.url.startsWith('https://'))
    .sort((a, b) => (a.width || 0) - (b.width || 0));
  const mid = pick.find((t) => (t.width || 0) >= 300) || pick[pick.length - 1];
  if (mid) return mid.url;
  return typeof e.thumbnail === 'string' && e.thumbnail.startsWith('https://') ? e.thumbnail : null;
};

/** yt-dlp -J --flat-playlist on `target` → { title, entries } or null. */
function flatList(target, env, limit) {
  return new Promise((resolve) => {
    const args = ['--ignore-config', ...UTF8, '--flat-playlist', '-J', '--ies', 'default,-generic', '--playlist-end', String(limit), '--no-warnings'];
    if (env.jsRuntime) args.push('--js-runtimes', `node:${env.jsRuntime}`);
    if (env.cookiesPath) args.push('--cookies', env.cookiesPath);
    args.push('--', target);
    execFile(env.ytDlpPath, args, { windowsHide: true, timeout: 90_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      let data;
      try { data = JSON.parse(stdout); } catch { return resolve(null); }
      if (data._type !== 'playlist' || !Array.isArray(data.entries)) return resolve(null);
      const entries = data.entries
        .filter((e) => e && typeof e === 'object')
        .map((e) => ({
          id: String(e.id || '').slice(0, 100),
          url: typeof e.url === 'string' ? e.url.slice(0, 300) : '',
          title: String(e.title || '').slice(0, 300),
          duration: Number.isFinite(e.duration) ? e.duration : null,
          channel: String(e.channel || e.uploader || '').slice(0, 120) || null,
          channelUrl: typeof e.channel_url === 'string' && /^https:\/\/www\.youtube\.com\/channel\/UC[\w-]{22}$/.test(e.channel_url) ? e.channel_url : null,
          thumbnail: httpsThumb(e),
        }))
        .slice(0, limit);
      resolve({ title: String(data.title || 'Playlist').slice(0, 300), entries });
    });
  });
}

/** Free text → up to `n` YouTube results (null when yt-dlp failed). */
async function search(query, env, n = 15) {
  const q = String(query || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200);
  if (!q) return [];
  const result = await flatList(`ytsearch${Math.max(1, Math.min(30, n))}:${q}`, env, n);
  return result ? result.entries : null;
}

/** Newest uploads of a channel (its videos tab, not its home page). */
function latestEntries(channelUrl, env, n = 15) {
  const u = new URL(channelUrl);
  if (/^\/(@[^/]+|channel\/[^/]+)\/?$/.test(u.pathname)) u.pathname = `${u.pathname.replace(/\/$/, '')}/videos`;
  return flatList(u.toString(), env, n);
}

module.exports = { youTubeUrl, flatList, search, latestEntries, isId: (id) => ID_RE.test(String(id || '')) };
