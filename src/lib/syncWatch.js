// v1.10, Sincronizar: the server merges what other devices saved; when it
// brought something in (appliedAt changes), the library on screen is read again.
import { api } from '../api.js';
import { useLibrary } from '../store/library.js';

export const WATCH_MS = 30_000;

/** Starts watching; returns a function that stops it. */
export function startSyncWatch({ get = api.get, reload = () => useLibrary.getState().loadAll(), every = WATCH_MS } = {}) {
  let seen = null;
  let stopped = false;
  const look = async () => {
    if (stopped || (typeof document !== 'undefined' && document.hidden)) return;
    let s;
    try { s = await get('/api/sync'); } catch { return; }
    if (!s || !s.enabled) { seen = null; return; }
    if (seen !== null && s.appliedAt && s.appliedAt !== seen) reload();
    seen = s.appliedAt || 0;
  };
  look();
  const t = setInterval(look, every);
  const onShow = () => { if (!document.hidden) look(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onShow);
  return () => { stopped = true; clearInterval(t); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onShow); };
}
