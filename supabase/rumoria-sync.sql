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

create table if not exists public.sync_libraries (
  id text primary key,
  encrypted_data text not null,
  updated_at timestamp with time zone default now()
);
alter table public.sync_libraries add column if not exists write_hash text;
alter table public.sync_libraries add column if not exists rev bigint not null default 0;

-- Only what Rumoria writes: a 64-hex id, "v1:" + base64, 10 MB at most.
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
     or length(p_data) > 10000000 or p_data !~ '^v1:[A-Za-z0-9+/=]+$' then
    raise exception 'invalid';
  end if;
  h := encode(sha256(convert_to(p_write_key, 'UTF8')), 'hex');
  select * into cur from public.sync_libraries s where s.id = p_id for update;
  if not found then
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
  delete from public.sync_libraries s
  where s.id = p_id and s.write_hash = encode(sha256(convert_to(p_write_key, 'UTF8')), 'hex');
end;
$$;

revoke all on function public.rumoria_get(text) from public;
revoke all on function public.rumoria_put(text, text, text, bigint) from public;
revoke all on function public.rumoria_delete(text, text) from public;
grant execute on function public.rumoria_get(text) to anon;
grant execute on function public.rumoria_put(text, text, text, bigint) to anon;
grant execute on function public.rumoria_delete(text, text) to anon;
