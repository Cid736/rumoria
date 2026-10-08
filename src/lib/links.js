// v1.5: a link dropped on the window (or pasted). A YouTube video plays at
// once, with similar songs after; a Spotify, Apple Music or YouTube list (or a
// Spotify profile) is imported. Anything else is refused. The server checks
// the link again when importing.
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_LIST = /^(PL|OLAK5uy_|UU|FL)[A-Za-z0-9_-]{10,60}$/;
const YT_HOSTS = new Set(['youtube.com', 'music.youtube.com']);

/** → { kind: 'song', yt } | { kind: 'list', url } | null */
export function classifyLink(raw) {
  const first = String(raw || '').trim().split(/\s+/)[0].slice(0, 2048);
  let u;
  try { u = new URL(first); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    return YT_ID.test(id) ? { kind: 'song', yt: id } : null;
  }
  if (YT_HOSTS.has(host)) {
    const list = u.searchParams.get('list') || '';
    const v = u.searchParams.get('v') || '';
    // A real playlist (not one of YouTube's own mixes, "RD…"): the list.
    if (YT_LIST.test(list)) return { kind: 'list', url: `https://www.youtube.com/playlist?list=${list}` };
    if (YT_ID.test(v)) return { kind: 'song', yt: v };
    const short = /^\/(shorts|live)\/([A-Za-z0-9_-]{11})$/.exec(u.pathname);
    return short ? { kind: 'song', yt: short[2] } : null;
  }
  if (host === 'open.spotify.com' || host === 'music.apple.com') return { kind: 'list', url: `https://${host}${u.pathname}` };
  return null;
}

/** The link in what's being dragged (a link from a browser, or text). */
export function linkOf(dataTransfer) {
  if (!dataTransfer) return '';
  const uri = (dataTransfer.getData('text/uri-list') || '').split(/\r?\n/).find((l) => l && !l.startsWith('#'));
  return uri || dataTransfer.getData('text/plain') || '';
}

/** Is a link (not our own rows, not files) being dragged in? */
export const carriesLink = (dataTransfer) => {
  const types = [...((dataTransfer && dataTransfer.types) || [])];
  return !types.includes('text/x-rumoria-row') && !types.includes('Files') && (types.includes('text/uri-list') || types.includes('text/plain'));
};
