// The page's only way to the local server. The secret travels by itself (an
// httpOnly cookie the desktop app set, or the dev proxy); changes add the
// X-CLMusic header the server requires against cross-site requests.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function call(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (method !== 'GET') {
    opts.headers['X-CLMusic'] = '1';
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new ApiError('Sin conexión con el servidor de la app.', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new ApiError((data && data.error) || `Error ${res.status}`, res.status);
  return data;
}

const qs = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();

export const api = {
  get: (url) => call('GET', url),
  post: (url, body) => call('POST', url, body ?? {}),
  patch: (url, body) => call('PATCH', url, body ?? {}),
  del: (url) => call('DELETE', url),
};

export const urls = {
  audio: (id) => `/api/stream/audio?${qs({ id })}`,
  local: (id) => `/api/local/file?${qs({ id })}`,
  info: (id) => `/api/stream/info?${qs({ id })}`,
  radio: (id) => `/api/stream/radio?${qs({ id })}`,
  lyrics: (id, a, t, d) => `/api/stream/lyrics?${qs({ id, a, t, d: d ? Math.round(d) : undefined })}`,
  search: (q) => `/api/search?${qs({ q })}`,
  find: (q, d, list, n) => `/api/find?${qs({ q, d: d ? Math.round(d) : undefined, list, n })}`,
  list: (id) => `/api/lists/${encodeURIComponent(id)}`,
};

/** The desktop app's extras (absent in a plain browser during development). */
export const desktop = typeof window !== 'undefined' && window.clmusic ? window.clmusic : null;
