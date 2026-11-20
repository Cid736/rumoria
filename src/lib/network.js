// v1.13: what the connection can take, from the browser's Network Information
// API (Android's WebView and Chromium have it; elsewhere it's absent and the
// usual audio plays). On mobile data, with "Ahorro de datos" on, or on a slow
// connection, the player asks for the light audio (~50–70 kb/s Opus instead
// of ~130 kb/s): it starts sooner and stutters less where coverage is poor.

const browserConnection = () => (typeof navigator !== 'undefined' && navigator.connection) || null;

/** 'lite' or 'normal', for the next song that loads. */
export function audioQuality(conn = browserConnection()) {
  if (!conn) return 'normal';
  if (conn.saveData) return 'lite';
  if (conn.type === 'cellular') return 'lite';
  if (conn.effectiveType && conn.effectiveType !== '4g') return 'lite';
  return 'normal';
}
