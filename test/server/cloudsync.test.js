// Sincronizar: the code, the keys, the sealed library, the merge, and two
// devices that are never on at the same time, through a pretend cloud that
// behaves like supabase/rumoria-sync.sql (rumoria_get / rumoria_put / rumoria_delete).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CloudSync, createCloud, newCode, normalizeCode, deriveKeys, seal, open, merge, baseOf, WORDS } = require('../../server/lib/cloudsync');
const { startApp } = require('../helpers');

/** Like the SQL: no listing, writes only with the write key and over the version they were based on. */
function fakeCloud() {
  const rows = new Map();
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  return {
    ready: true,
    rows,
    calls: [],
    async get(id) { this.calls.push(['get', id]); const r = rows.get(id); return r ? { data: r.data, rev: r.rev } : null; },
    async put(id, data, write, baseRev) {
      this.calls.push(['put', id, data, write]);
      const r = rows.get(id);
      if (!r) { rows.set(id, { data, rev: 1, wh: sha(write) }); return { ok: true, rev: 1 }; }
      if (r.wh !== sha(write)) throw new Error('forbidden');
      if (r.rev !== baseRev) return { ok: false, rev: r.rev };
      rows.set(id, { ...r, data, rev: r.rev + 1 });
      return { ok: true, rev: r.rev + 1 };
    },
    async remove(id, write) { const r = rows.get(id); if (r && r.wh === sha(write)) rows.delete(id); },
  };
}

const list = (id, name, tracks = [], updatedAt = 1) => ({ id, name, source: 'own', tracks: tracks.map((t) => ({ title: t, artist: 'A' })), updatedAt });
const like = (key, at) => ({ key, title: key, artist: 'A', at });

/** A device: its library in memory, and its sync.json in a folder of its own. */
function device(cloud, lib = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rum-sync-'));
  const store = { lists: [], likes: [], rules: [], ...lib };
  const stores = {
    files: [],
    read: () => JSON.parse(JSON.stringify(store)),
    write: (m) => { store.lists = m.lists; store.likes = m.likes; store.rules = m.rules; },
  };
  const s = new CloudSync({ file: path.join(dir, 'sync.json'), stores, cloud, background: false });
  return { s, store, dir, names: () => store.lists.map((l) => l.name) };
}

test('code: 6 words from the list; typed any way, read one way; anything else is not a code', () => {
  assert.equal(WORDS.length, 2048);
  const c = newCode();
  assert.equal(c.split('-').length, 6);
  assert.equal(normalizeCode(c), c);
  assert.equal(normalizeCode('ÁBACO abdomen  Abeja,abierto/ABOGADO abono'), 'ábaco-abdomen-abeja-abierto-abogado-abono');
  assert.equal(normalizeCode('abaco abdomen abeja abierto abogado'), null, 'five words');
  assert.equal(normalizeCode('abaco abdomen abeja abierto abogado gatito'), null, 'a word not in the list');
  assert.equal(normalizeCode('gato-rojo-592'), null);
  assert.equal(normalizeCode(''), null);
});

test('keys: slow, the same for the same code, and the id gives nothing away (not a hash of the code)', async () => {
  const code = 'ábaco-abdomen-abeja-abierto-abogado-abono';
  const a = await deriveKeys(code);
  const b = await deriveKeys('abaco-abdomen-abeja-abierto-abogado-abono');
  assert.equal(a.id, b.id, 'accents do not change the code');
  assert.match(a.id, /^[0-9a-f]{64}$/);
  assert.match(a.write, /^[0-9a-f]{64}$/);
  assert.notEqual(a.id, crypto.createHash('sha256').update(code).digest('hex'));
  assert.notEqual(a.id, a.write);
  const other = await deriveKeys('abono-abogado-abierto-abeja-abdomen-ábaco');
  assert.notEqual(other.id, a.id);
});

test('sealed library: nothing readable, a new nonce each time; a wrong code or a changed byte cannot open it', async () => {
  const k = await deriveKeys(newCode());
  const lib = { v: 1, lists: [list('l1', 'Mi lista secreta', ['Canción privada'])], likes: [], rules: [] };
  const s1 = seal(lib, k);
  const s2 = seal(lib, k);
  assert.match(s1, /^v1:[A-Za-z0-9+/=]+$/);
  assert.notEqual(s1, s2);
  assert.ok(!s1.includes('secreta') && !Buffer.from(s1.slice(3), 'base64').toString('latin1').includes('secreta'));
  assert.deepEqual(open(s1, k), lib);
  await assert.rejects(async () => open(s1, await deriveKeys(newCode())), /código no es el de estos datos/);
  const raw = Buffer.from(s1.slice(3), 'base64');
  raw[20] ^= 1;
  assert.throws(() => open(`v1:${raw.toString('base64')}`, k), /código no es el de estos datos/);
  // Bound to its id: the same text under another row's id does not open.
  assert.throws(() => open(s1, { ...k, id: 'f'.repeat(64) }), /código no es el de estos datos/);
});

test('merge: new on either side kept, changed on one side wins, deleted on one side goes, changed on both: newer', () => {
  const base0 = { lists: [list('a', 'A'), list('b', 'B'), list('c', 'C')], likes: [like('yt:1', 1)], rules: [] };
  const base = baseOf(base0);
  const local = { lists: [list('a', 'A local', [], 5), list('b', 'B'), list('d', 'D nueva aquí')], likes: [like('yt:1', 1), like('yt:2', 9)], rules: [] };
  const remote = { lists: [list('a', 'A remota', [], 3), list('c', 'C cambiada', [], 7), list('e', 'E nueva allí')], likes: [], rules: [] };
  const m = merge(base, local, remote);
  const by = Object.fromEntries(m.lists.map((l) => [l.id, l.name]));
  assert.equal(by.a, 'A local', 'changed on both: the newer');
  assert.equal(by.b, undefined, 'deleted there, untouched here: gone');
  assert.equal(by.c, 'C cambiada', 'deleted here but changed there: kept');
  assert.equal(by.d, 'D nueva aquí');
  assert.equal(by.e, 'E nueva allí');
  assert.deepEqual(m.likes.map((s) => s.key), ['yt:2'], 'unliked there: gone; liked here: kept');
  // With nothing in common (a device joining): both, nothing lost.
  const joined = merge(null, { lists: [list('x', 'X')], likes: [like('yt:9', 2)], rules: [] }, remote);
  assert.deepEqual(joined.lists.map((l) => l.id).sort(), ['a', 'c', 'e', 'x']);
  assert.equal(joined.likes.length, 1);
});

test('two devices, never on together: PC makes a code, the phone joins, changes go both ways', async () => {
  const cloud = fakeCloud();
  const pc = device(cloud, { lists: [list('p1', 'Rock'), list('p2', 'Para borrar')], likes: [like('yt:a', 5)] });
  const phone = device(cloud, { lists: [list('m1', 'Del móvil')] });
  try {
    const st = await pc.s.create();
    assert.equal(st.enabled, true);
    assert.equal(st.error, null);
    assert.equal(cloud.rows.size, 1);
    const [[id, row]] = [...cloud.rows];
    assert.ok(!row.data.includes('Rock'), 'the cloud gets it encrypted');
    assert.ok(!JSON.stringify(cloud.calls).includes(st.code.split('-')[0]), 'the code never goes out');
    assert.equal(id, (await deriveKeys(st.code)).id);

    // The phone, with the code typed in capitals and spaces.
    await phone.s.join(st.code.toUpperCase().replace(/-/g, ' '));
    assert.deepEqual(phone.names().sort(), ['Del móvil', 'Para borrar', 'Rock']);
    assert.deepEqual(phone.store.likes.map((s) => s.key), ['yt:a']);
    // The PC, later: gets the phone's list.
    await pc.s.syncNow();
    assert.deepEqual(pc.names().sort(), ['Del móvil', 'Para borrar', 'Rock']);

    // The PC deletes a list and likes a song, closes. The phone opens later.
    pc.store.lists = pc.store.lists.filter((l) => l.id !== 'p2');
    pc.store.likes.unshift(like('yt:b', 9));
    await pc.s.syncNow();
    await phone.s.syncNow();
    assert.deepEqual(phone.names().sort(), ['Del móvil', 'Rock']);
    assert.deepEqual(phone.store.likes.map((s) => s.key), ['yt:b', 'yt:a']);
    assert.ok(phone.s.status().appliedAt, 'the page is told something came in');

    // Both change things while apart: nothing is lost.
    pc.store.lists.push(list('p3', 'Del PC sin conexión'));
    phone.store.lists.push(list('m2', 'Del móvil sin conexión'));
    await phone.s.syncNow();
    await pc.s.syncNow();
    await phone.s.syncNow();
    for (const d of [pc, phone]) assert.deepEqual(d.names().sort(), ['Del PC sin conexión', 'Del móvil', 'Del móvil sin conexión', 'Rock']);
  } finally {
    for (const d of [pc, phone]) fs.rmSync(d.dir, { recursive: true, force: true });
  }
});

test('joining: a mistyped or unknown code says so and changes nothing', async () => {
  const cloud = fakeCloud();
  const d = device(cloud, { lists: [list('x', 'X')] });
  try {
    await assert.rejects(d.s.join('hola que tal'), /no es válido/);
    await assert.rejects(d.s.join(newCode()), /No hay nada guardado/);
    assert.equal(d.s.status().enabled, false);
    assert.equal(cloud.rows.size, 0);
  } finally { fs.rmSync(d.dir, { recursive: true, force: true }); }
});

test('someone with the id but not the code can neither read nor overwrite', async () => {
  const cloud = fakeCloud();
  const d = device(cloud, { lists: [list('x', 'Mía')] });
  try {
    const { code } = await d.s.create();
    const k = await deriveKeys(code);
    const before = cloud.rows.get(k.id).data;
    await assert.rejects(cloud.put(k.id, 'v1:AAAA', 'f'.repeat(64), 1), /forbidden/);
    assert.equal(cloud.rows.get(k.id).data, before);
    await assert.rejects(async () => open(before, await deriveKeys(newCode())));
  } finally { fs.rmSync(d.dir, { recursive: true, force: true }); }
});

test('another device saving in between: merged again, not overwritten', async () => {
  const cloud = fakeCloud();
  const a = device(cloud, { lists: [list('a1', 'A')] });
  const b = device(cloud);
  try {
    const { code } = await a.s.create();
    await b.s.join(code);
    // While A is between reading and writing, B saves.
    const realGet = cloud.get.bind(cloud);
    let once = true;
    cloud.get = async (id) => {
      const r = await realGet(id);
      if (once) { once = false; b.store.lists.push(list('b1', 'De B')); await b.s.syncNow(); }
      return r;
    };
    a.store.lists.push(list('a2', 'Otra de A'));
    await a.s.syncNow();
    assert.equal(a.s.status().error, null);
    assert.deepEqual(a.names().sort(), ['A', 'De B', 'Otra de A']);
    cloud.get = realGet;
    await b.s.syncNow();
    assert.deepEqual(b.names().sort(), ['A', 'De B', 'Otra de A']);
  } finally { for (const d of [a, b]) fs.rmSync(d.dir, { recursive: true, force: true }); }
});

test('leaving: this device stops; with "borrar de la nube", the copy goes for everyone', async () => {
  const cloud = fakeCloud();
  const d = device(cloud, { lists: [list('x', 'X')] });
  try {
    await d.s.create();
    assert.ok(fs.existsSync(path.join(d.dir, 'sync.json')));
    await d.s.leave({ wipe: true });
    assert.equal(cloud.rows.size, 0);
    assert.equal(d.s.status().enabled, false);
    assert.ok(!fs.existsSync(path.join(d.dir, 'sync.json')));
    assert.deepEqual(d.names(), ['X'], 'the library here stays');
  } finally { fs.rmSync(d.dir, { recursive: true, force: true }); }
});

test('cloud client: only an https *.supabase.co project and a publishable key; the key goes as apikey, nothing else', async () => {
  assert.equal(createCloud({ url: '', key: 'sb_publishable_abcdefghijk' }).ready, false);
  assert.equal(createCloud({ url: 'http://x.supabase.co', key: 'sb_publishable_abcdefghijk' }).ready, false);
  assert.equal(createCloud({ url: 'https://evil.com', key: 'sb_publishable_abcdefghijk' }).ready, false);
  assert.equal(createCloud({ url: 'https://abc.supabase.co', key: 'sb_secret_abcdefghijk' }).ready, false, 'never a secret key');
  const seen = [];
  const c = createCloud({
    url: 'https://abc.supabase.co/', key: 'sb_publishable_abcdefghijk',
    fetchImpl: async (u, o) => { seen.push({ u, o }); return { ok: true, status: 200, text: async () => '[{"encrypted_data":"v1:AA==","rev":3}]' }; },
  });
  assert.deepEqual(await c.get('a'.repeat(64)), { data: 'v1:AA==', rev: 3 });
  assert.equal(seen[0].u, 'https://abc.supabase.co/rest/v1/rpc/rumoria_get');
  assert.equal(seen[0].o.headers.apikey, 'sb_publishable_abcdefghijk');
  assert.equal(seen[0].o.headers.Authorization, undefined);
  assert.equal(seen[0].o.redirect, 'error');
  const empty = createCloud({ url: 'https://abc.supabase.co', key: 'sb_publishable_abcdefghijk', fetchImpl: async () => ({ ok: true, status: 204, text: async () => '' }) });
  await empty.remove('a'.repeat(64), 'b'.repeat(64));
  const down = createCloud({ url: 'https://abc.supabase.co', key: 'sb_publishable_abcdefghijk', fetchImpl: async () => { throw new Error('offline'); } });
  await assert.rejects(down.get('a'.repeat(64)), /Sin conexión/);
});

test('api: Sincronizar from the page (create, status, leave), "Para ti" never leaves the device', async () => {
  const cloud = fakeCloud();
  const { fakeYouTube } = require('../helpers');
  const app = await startApp({ yt: { ...fakeYouTube(), cloud } });
  try {
    const { lists } = app.state;
    lists.lists.push({ ...list('aaaaaaaa', 'Mía'), createdAt: 1, folder: null, sync: false, syncedAt: null, keep: null, auto: null, gone: [] });
    lists.lists.push({ ...list('bbbbbbbb', 'Para ti: Pop'), createdAt: 1, folder: 'Para ti', sync: false, syncedAt: null, keep: null, auto: { q: 'pop', every: 24, by: 'rumoria', at: 0 }, gone: [] });
    lists.save();
    assert.equal((await app.call('GET', '/api/sync')).data.enabled, false);
    const r = await app.call('POST', '/api/sync/create', { body: {} });
    assert.equal(r.status, 200);
    assert.equal(r.data.enabled, true);
    assert.equal(normalizeCode(r.data.code), r.data.code);
    const k = await deriveKeys(r.data.code);
    const lib = open(cloud.rows.get(k.id).data, k);
    assert.deepEqual(lib.lists.map((l) => l.name), ['Mía']);
    assert.equal((await app.call('POST', '/api/sync/create', { body: {} })).status, 400, 'once');
    assert.equal((await app.call('POST', '/api/sync/join', { body: { code: 'no' } })).status, 400);
    assert.equal((await app.call('GET', '/api/sync', { auth: false })).status, 401);
    const off = await app.call('POST', '/api/sync/leave', { body: { wipe: true } });
    assert.equal(off.data.enabled, false);
    assert.equal(cloud.rows.size, 0);
  } finally { await app.close(); }
});

test('what a device cannot keep (another version, a broken item) is never taken as deleted, nor lost for the others', async () => {
  const cloud = fakeCloud();
  const pc = device(cloud, { lists: [list('ok', 'Normal'), list('nuevo', 'Solo la versión nueva la entiende')] });
  const phone = device(cloud);
  // The phone's Rumoria drops lists it can't read, and tidies every list (adds a field), as its cleaning does.
  phone.s.stores.clean = (lib) => ({ ...lib, lists: lib.lists.filter((l) => l.id !== 'nuevo').map((l) => ({ ...l, folder: l.folder || null })) });
  const write = phone.s.stores.write;
  let writes = 0;
  phone.s.stores.write = (m) => { writes += 1; write(phone.s.stores.clean(m)); };
  try {
    const { code } = await pc.s.create();
    await phone.s.join(code);
    assert.deepEqual(phone.names(), ['Normal']);
    await phone.s.syncNow();
    await phone.s.syncNow();
    assert.equal(writes, 1, 'once: no rewriting the same thing every time');
    await pc.s.syncNow();
    assert.deepEqual(pc.names().sort(), ['Normal', 'Solo la versión nueva la entiende'], 'still on the PC');
    phone.store.lists.push(list('m1', 'Del móvil'));
    await phone.s.syncNow();
    await pc.s.syncNow();
    assert.deepEqual(pc.names().sort(), ['Del móvil', 'Normal', 'Solo la versión nueva la entiende']);
  } finally { for (const d of [pc, phone]) fs.rmSync(d.dir, { recursive: true, force: true }); }
});

test('the cloud copy lost or started again: the libraries are joined, nothing taken as deleted', async () => {
  const cloud = fakeCloud();
  const pc = device(cloud, { lists: [list('p1', 'Del PC')] });
  const phone = device(cloud, { lists: [list('m1', 'Del móvil')] });
  try {
    const { code } = await pc.s.create();
    await phone.s.join(code);
    await pc.s.syncNow();
    // The PC adds lists the phone hasn't seen yet.
    for (let i = 0; i < 3; i++) { pc.store.lists.push(list(`x${i}`, `Más ${i}`)); await pc.s.syncNow(); }
    // The table is emptied (deleted and made again).
    cloud.rows.clear();
    phone.store.lists.push(list('m2', 'Nueva del móvil'));
    await phone.s.syncNow(); // the phone puts its library back (rev 1)
    await pc.s.syncNow(); // the PC had seen a later version: joins, doesn't delete
    const all = ['Del PC', 'Del móvil', 'Más 0', 'Más 1', 'Más 2', 'Nueva del móvil'];
    assert.deepEqual(pc.names().sort(), all);
    await phone.s.syncNow();
    assert.deepEqual(phone.names().sort(), all);
  } finally { for (const d of [pc, phone]) fs.rmSync(d.dir, { recursive: true, force: true }); }
});

test('a project without the table or functions says so in plain words', async () => {
  const c = createCloud({ url: 'https://abc.supabase.co', key: 'sb_publishable_abcdefghijk', fetchImpl: async () => ({ ok: false, status: 404, text: async () => '{"code":"42P01","message":"relation \\"public.sync_libraries\\" does not exist"}' }) });
  await assert.rejects(c.get('a'.repeat(64)), /La nube no está preparada/);
});

test('v1.12.1: the cloud limits (too many calls, no room) say so in plain words', async () => {
  const answer = (status, body) => createCloud({ url: 'https://abc.supabase.co', key: 'sb_publishable_abcdefghijk', fetchImpl: async () => ({ ok: false, status, text: async () => body }) });
  await assert.rejects(answer(429, '{"code":"PT429","message":"rate_limited"}').put('a'.repeat(64), 'v1:AAAA', 'b'.repeat(64), 0), /demasiadas peticiones/);
  await assert.rejects(answer(400, '{"code":"P0001","message":"cloud_full"}').put('a'.repeat(64), 'v1:AAAA', 'b'.repeat(64), 0), /está llena/);
});
