-- Rumoria · Sincronizar. Run once in Supabase → SQL Editor (it can be run again).
--
-- The table keeps, for each code, only: its id (derived from the code, slowly,
-- on the device), the library encrypted on the device (AES-256-GCM), a
-- SHA-256 of the write key, a version number and when it changed.
-- Nobody can read or list the table: the app (the publishable key, role
-- "anon") can only call these three functions:
--   rumoria_get(id)                         → that row (whoever knows its id)
--   rumoria_put(id, data, write_key, base)  → saves only with the write key
--                                             and over version `base`
--   rumoria_delete(id, write_key)           → removes it (write key needed)
--
-- v1.12.1, against floods (the publishable key is inside every copy of the
-- app, so anyone can call these): per IP, at most 60 saves and 20 removals
-- every 10 minutes and 5 new libraries an hour; a library at most 6 MB (the
-- biggest Rumoria can make is under 5); and the whole table stops growing at
-- 20 000 libraries or 400 MB, well before the free plan's 500 MB (past them,
-- Supabase turns the project read-only and Sincronizar would stop for all).
-- Reading needs the id, which only the code gives: it isn't limited.

create table if not exists public.sync_libraries (
  id text primary key,
  encrypted_data text not null,
  updated_at timestamp with time zone default now()
);
alter table public.sync_libraries add column if not exists write_hash text;
alter table public.sync_libraries add column if not exists rev bigint not null default 0;

-- Only what Rumoria writes: a 64-hex id, "v1:" + base64, 10 MB at most
-- (new saves: 6 MB, checked in rumoria_put).
do $$ begin
  alter table public.sync_libraries add constraint sync_libraries_id_hex check (id ~ '^[0-9a-f]{64}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.sync_libraries add constraint sync_libraries_data_format check (encrypted_data ~ '^v1:[A-Za-z0-9+/=]+$' and length(encrypted_data) <= 10000000);
exception when duplicate_object then null; end $$;

-- No direct access at all: RLS on, every policy removed, rights taken away.
alter table public.sync_libraries enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'sync_libraries' loop
    execute format('drop policy %I on public.sync_libraries', p.policyname);
  end loop;
end $$;
revoke all on table public.sync_libraries from anon, authenticated;

-- Realtime is not used (the devices look when they open and every few minutes).
do $$ begin
  alter publication supabase_realtime drop table public.sync_libraries;
exception when others then null; end $$;

-- ---- v1.12.1: limits per IP ----
-- In a schema the API doesn't show (only "public" is), out of reach of the
-- publishable key; only the functions below write here.
create schema if not exists rumoria_private;
revoke all on schema rumoria_private from public, anon, authenticated;
create table if not exists rumoria_private.hits (
  ip text not null,
  kind text not null,
  at timestamp with time zone not null default now()
);
create index if not exists hits_ip_kind_at on rumoria_private.hits (ip, kind, at);
alter table rumoria_private.hits enable row level security;
revoke all on table rumoria_private.hits from public, anon, authenticated;

-- One more `kind` from this IP, or 'rate_limited' if it had `max` already
-- in `win` (PT429: the API answers 429). The IP: the first one in
-- X-Forwarded-For, which Supabase's gateway sets (as its guide on securing
-- the API does). A refused call isn't counted (the exception undoes the
-- insert). Old hits go now and then.
create or replace function rumoria_private.throttle(p_kind text, p_max int, p_win interval)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_ip text;
  n int;
begin
  v_ip := coalesce(nullif(trim(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1)), ''), 'unknown');
  select count(*) into n from rumoria_private.hits h where h.ip = v_ip and h.kind = p_kind and h.at > now() - p_win;
  if n >= p_max then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;
  insert into rumoria_private.hits (ip, kind) values (v_ip, p_kind);
  if random() < 0.01 then
    delete from rumoria_private.hits h where h.at < now() - interval '1 day';
  end if;
end;
$$;
revoke all on function rumoria_private.throttle(text, int, interval) from public, anon, authenticated;

-- The whole table past 20 000 libraries or 400 MB: nothing new, nothing bigger.
create or replace function rumoria_private.full()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select count(*) from public.sync_libraries) >= 20000
      or pg_total_relation_size('public.sync_libraries') >= 400 * 1024 * 1024;
$$;
revoke all on function rumoria_private.full() from public, anon, authenticated;

create or replace function public.rumoria_get(p_id text)
returns table (encrypted_data text, rev bigint)
language sql stable security definer set search_path = ''
as $$
  select s.encrypted_data, s.rev from public.sync_libraries s
  where p_id ~ '^[0-9a-f]{64}$' and s.id = p_id;
$$;

create or replace function public.rumoria_put(p_id text, p_data text, p_write_key text, p_base_rev bigint)
returns table (ok boolean, rev bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  cur public.sync_libraries%rowtype;
  h text;
begin
  if p_id !~ '^[0-9a-f]{64}$' or p_write_key !~ '^[0-9a-f]{64}$' or p_data is null
     or length(p_data) > 6000000 or p_data !~ '^v1:[A-Za-z0-9+/=]+$' then
    raise exception 'invalid';
  end if;
  perform rumoria_private.throttle('put', 60, interval '10 minutes');
  h := encode(sha256(convert_to(p_write_key, 'UTF8')), 'hex');
  select * into cur from public.sync_libraries s where s.id = p_id for update;
  if not found then
    perform rumoria_private.throttle('new', 5, interval '1 hour');
    if rumoria_private.full() then
      raise exception 'cloud_full';
    end if;
    begin
      insert into public.sync_libraries (id, encrypted_data, write_hash, rev, updated_at) values (p_id, p_data, h, 1, now());
    exception when unique_violation then
      -- Another device made it at the same moment: it merges and tries again.
      return query select false, 0::bigint;
      return;
    end;
    return query select true, 1::bigint;
    return;
  end if;
  if cur.write_hash is distinct from h then
    raise exception 'forbidden';
  end if;
  if cur.rev <> p_base_rev then
    return query select false, cur.rev;
    return;
  end if;
  -- A library may always stay its size or shrink; it grows only while there's room.
  if length(p_data) > length(cur.encrypted_data) and rumoria_private.full() then
    raise exception 'cloud_full';
  end if;
  update public.sync_libraries s set encrypted_data = p_data, rev = cur.rev + 1, updated_at = now() where s.id = p_id;
  return query select true, cur.rev + 1;
end;
$$;

create or replace function public.rumoria_delete(p_id text, p_write_key text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_id !~ '^[0-9a-f]{64}$' or p_write_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid';
  end if;
  perform rumoria_private.throttle('delete', 20, interval '10 minutes');
  delete from public.sync_libraries s
  where s.id = p_id and s.write_hash = encode(sha256(convert_to(p_write_key, 'UTF8')), 'hex');
end;
$$;

-- Only anon may call them: Supabase also gives "authenticated" every new
-- function in public by default, and Rumoria has no accounts.
revoke all on function public.rumoria_get(text) from public, authenticated;
revoke all on function public.rumoria_put(text, text, text, bigint) from public, authenticated;
revoke all on function public.rumoria_delete(text, text) from public, authenticated;
grant execute on function public.rumoria_get(text) to anon;
grant execute on function public.rumoria_put(text, text, text, bigint) to anon;
grant execute on function public.rumoria_delete(text, text) to anon;
