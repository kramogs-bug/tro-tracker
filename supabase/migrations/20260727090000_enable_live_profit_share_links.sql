create extension if not exists pgcrypto with schema extensions;

alter table public.profit_share_snapshots
  add column if not exists share_mode text not null default 'snapshot'
    check (share_mode in ('snapshot', 'live')),
  add column if not exists updated_at timestamptz;

update public.profit_share_snapshots
set updated_at = created_at
where updated_at is null;

alter table public.profit_share_snapshots
  alter column updated_at
    set default pg_catalog.statement_timestamp(),
  alter column updated_at
    set not null;

create table if not exists public.profit_share_editors (
  share_id text primary key
    references public.profit_share_snapshots(id) on delete cascade,
  owner_id uuid not null
    references auth.users(id) on delete cascade,
  player_key text not null
    check (
      pg_catalog.char_length(player_key) between 1 and 128
    ),
  token_hash bytea not null
    check (pg_catalog.octet_length(token_hash) = 32),
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  unique (owner_id, player_key)
);

alter table public.profit_share_editors enable row level security;

revoke all on table public.profit_share_editors from public;
revoke all on table public.profit_share_editors from anon, authenticated;

create or replace function public.create_live_profit_share(
  p_id text,
  p_player_key text,
  p_editor_token text,
  p_snapshot jsonb
)
returns table (
  share_id text,
  share_expires_at timestamptz,
  share_updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_expires_at timestamptz := v_now + interval '30 days';
  v_owner_id uuid := (select auth.uid());
begin
  if v_owner_id is null then
    raise exception 'Cloud account required';
  end if;

  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{10,16}$' then
    raise exception 'Invalid share ID';
  end if;

  if p_player_key is null
    or pg_catalog.char_length(p_player_key) not between 1 and 128
  then
    raise exception 'Invalid player key';
  end if;

  if p_editor_token is null
    or p_editor_token !~ '^[A-Za-z0-9_-]{32,128}$'
  then
    raise exception 'Invalid editor token';
  end if;

  if p_snapshot is null
    or pg_catalog.jsonb_typeof(p_snapshot) <> 'object'
    or p_snapshot ->> 'kind' <> 'tro-profit-summary'
    or p_snapshot ->> 'version' <> '1'
    or pg_catalog.octet_length(p_snapshot::text) > 20000
  then
    raise exception 'Invalid profit snapshot';
  end if;

  delete from public.profit_share_snapshots
  where expires_at <= v_now;

  delete from public.profit_share_snapshots as shares
  using public.profit_share_editors as editors
  where editors.share_id = shares.id
    and editors.owner_id = v_owner_id
    and editors.player_key = p_player_key;

  insert into public.profit_share_snapshots (
    id,
    snapshot,
    share_mode,
    created_at,
    updated_at,
    expires_at
  )
  values (
    p_id,
    p_snapshot,
    'live',
    v_now,
    v_now,
    v_expires_at
  );

  insert into public.profit_share_editors (
    share_id,
    owner_id,
    player_key,
    token_hash
  )
  values (
    p_id,
    v_owner_id,
    p_player_key,
    extensions.digest(p_editor_token, 'sha256')
  );

  return query
  values (p_id, v_expires_at, v_now);
end;
$$;

create or replace function public.update_live_profit_share(
  p_id text,
  p_editor_token text,
  p_snapshot jsonb
)
returns table (
  share_id text,
  share_expires_at timestamptz,
  share_updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
begin
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{10,16}$' then
    raise exception 'Invalid share ID';
  end if;

  if p_editor_token is null
    or p_editor_token !~ '^[A-Za-z0-9_-]{32,128}$'
  then
    raise exception 'Invalid editor token';
  end if;

  if p_snapshot is null
    or pg_catalog.jsonb_typeof(p_snapshot) <> 'object'
    or p_snapshot ->> 'kind' <> 'tro-profit-summary'
    or p_snapshot ->> 'version' <> '1'
    or pg_catalog.octet_length(p_snapshot::text) > 20000
  then
    raise exception 'Invalid profit snapshot';
  end if;

  return query
  update public.profit_share_snapshots as shares
  set
    snapshot = p_snapshot,
    updated_at = v_now
  from public.profit_share_editors as editors
  where shares.id = p_id
    and shares.share_mode = 'live'
    and shares.expires_at > v_now
    and editors.share_id = shares.id
    and editors.token_hash = extensions.digest(p_editor_token, 'sha256')
  returning shares.id, shares.expires_at, shares.updated_at;
end;
$$;

create or replace function public.get_profit_share(
  p_id text
)
returns table (
  share_snapshot jsonb,
  share_kind text,
  share_updated_at timestamptz,
  share_expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{10,16}$' then
    return;
  end if;

  return query
  select
    shares.snapshot,
    shares.share_mode,
    shares.updated_at,
    shares.expires_at
  from public.profit_share_snapshots as shares
  where shares.id = p_id
    and shares.expires_at > pg_catalog.statement_timestamp();
end;
$$;

revoke all on function public.create_live_profit_share(
  text,
  text,
  text,
  jsonb
)
  from public;
grant execute on function public.create_live_profit_share(
  text,
  text,
  text,
  jsonb
)
  to authenticated;

revoke all on function public.update_live_profit_share(text, text, jsonb)
  from public;
grant execute on function public.update_live_profit_share(text, text, jsonb)
  to anon, authenticated;

revoke all on function public.get_profit_share(text) from public;
grant execute on function public.get_profit_share(text)
  to anon, authenticated;

revoke execute on function public.create_profit_share(text, jsonb)
  from anon, authenticated;

drop policy if exists "Anyone can read active profit shares"
  on public.profit_share_snapshots;
revoke select on table public.profit_share_snapshots
  from anon, authenticated;
