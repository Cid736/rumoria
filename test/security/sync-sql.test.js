// supabase/rumoria-sync.sql stays closed (RLS, no policies, only anon may
// call the three functions) and, v1.12.1, keeps its limits against floods.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'rumoria-sync.sql'), 'utf8');
const fn = (name) => {
  const at = sql.indexOf(`create or replace function ${name}(`);
  assert.ok(at >= 0, name);
  return sql.slice(at, sql.indexOf('$$;', at));
};

test('sync sql: the table closed, the functions only for anon, every one with a fixed search_path', () => {
  assert.match(sql, /alter table public\.sync_libraries enable row level security;/);
  assert.match(sql, /revoke all on table public\.sync_libraries from anon, authenticated;/);
  assert.doesNotMatch(sql, /create policy/i);
  for (const f of ['public.rumoria_get', 'public.rumoria_put', 'public.rumoria_delete', 'rumoria_private.throttle', 'rumoria_private.full']) {
    assert.match(fn(f), /security definer set search_path = ''/, f);
  }
  for (const f of ['rumoria_get(text)', 'rumoria_put(text, text, text, bigint)', 'rumoria_delete(text, text)']) {
    assert.ok(sql.includes(`revoke all on function public.${f} from public, authenticated;`), f);
    assert.ok(sql.includes(`grant execute on function public.${f} to anon;`), f);
  }
  assert.doesNotMatch(sql, /grant [^;]* to authenticated/);
  assert.doesNotMatch(sql, /grant [^;]*rumoria_private/);
});

test('sync sql: limits per IP on saves, new libraries and removals; 6 MB a library; the table stops growing', () => {
  const put = fn('public.rumoria_put');
  assert.match(put, /length\(p_data\) > 6000000/);
  assert.match(put, /throttle\('put', 60, interval '10 minutes'\)/);
  assert.match(put, /throttle\('new', 5, interval '1 hour'\)/);
  assert.equal((put.match(/rumoria_private\.full\(\)/g) || []).length, 2, 'checked for new libraries and for ones that grow');
  assert.match(fn('public.rumoria_delete'), /throttle\('delete', 20, interval '10 minutes'\)/);
  const throttle = fn('rumoria_private.throttle');
  assert.match(throttle, /errcode = 'PT429'/);
  assert.match(throttle, /split_part\(coalesce\(current_setting\('request\.headers', true\)::json ->> 'x-forwarded-for'/);
  assert.match(fn('rumoria_private.full'), />= 20000\s+or pg_total_relation_size\('public\.sync_libraries'\) >= 400 \* 1024 \* 1024/);
  assert.match(sql, /revoke all on schema rumoria_private from public, anon, authenticated;/);
  assert.match(sql, /revoke all on table rumoria_private\.hits from public, anon, authenticated;/);
  // The app refuses to send what the cloud would refuse.
  const client = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'lib', 'cloudsync.js'), 'utf8');
  assert.match(client, /const MAX_TEXT = 6_000_000;/);
});
