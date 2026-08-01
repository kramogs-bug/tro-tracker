create table if not exists public.player_team_notes (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null
    references auth.users(id) on delete cascade,
  player_key text not null
    check (pg_catalog.char_length(player_key) between 1 and 128),
  player_name text not null
    check (pg_catalog.char_length(player_name) between 1 and 50),
  client_note_id text not null
    check (pg_catalog.char_length(client_note_id) between 10 and 128),
  body text not null
    check (pg_catalog.char_length(body) between 1 and 240),
  created_at timestamptz not null
    default pg_catalog.statement_timestamp(),
  unique (owner_id, player_key, client_note_id)
);

create index if not exists player_team_notes_owner_created_idx
  on public.player_team_notes (owner_id, created_at desc);

create index if not exists player_team_notes_player_created_idx
  on public.player_team_notes (owner_id, player_key, created_at desc);

alter table public.player_team_notes enable row level security;

revoke all on table public.player_team_notes from public;
revoke all on table public.player_team_notes from anon, authenticated;

create or replace function public.get_player_team_notes(
  p_share_id text,
  p_submission_token text
)
returns table (
  note_id uuid,
  note_player_name text,
  note_body text,
  note_created_at timestamptz,
  note_is_current_player boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_owner_id uuid;
  v_player_key text;
begin
  if p_share_id is null
    or p_share_id !~ '^[A-Za-z0-9_-]{10,16}$'
    or p_submission_token is null
    or p_submission_token !~ '^[A-Za-z0-9_-]{32,128}$'
  then
    raise exception 'Invalid player link';
  end if;

  select editors.owner_id, editors.player_key
  into v_owner_id, v_player_key
  from public.profit_share_editors as editors
  join public.profit_share_snapshots as shares
    on shares.id = editors.share_id
  where editors.share_id = p_share_id
    and shares.share_mode = 'live'
    and shares.expires_at > v_now
    and editors.submission_token_hash =
      extensions.digest(p_submission_token, 'sha256');

  if v_owner_id is null then
    raise exception 'Invalid or expired player link';
  end if;

  return query
  select
    recent.id,
    recent.player_name,
    recent.body,
    recent.created_at,
    recent.player_key = v_player_key
  from (
    select
      notes.id,
      notes.player_key,
      notes.player_name,
      notes.body,
      notes.created_at
    from public.player_team_notes as notes
    where notes.owner_id = v_owner_id
      and notes.created_at > v_now - interval '14 days'
    order by notes.created_at desc
    limit 100
  ) as recent
  order by recent.created_at;
end;
$$;

revoke all on function public.get_player_team_notes(text, text)
  from public;
grant execute on function public.get_player_team_notes(text, text)
  to anon, authenticated;

create or replace function public.post_player_team_note(
  p_share_id text,
  p_submission_token text,
  p_client_note_id text,
  p_body text
)
returns table (
  note_id uuid,
  note_player_name text,
  note_body text,
  note_created_at timestamptz,
  note_is_current_player boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_owner_id uuid;
  v_player_key text;
  v_player_name text;
  v_body text;
  v_recent_count integer;
begin
  if p_share_id is null
    or p_share_id !~ '^[A-Za-z0-9_-]{10,16}$'
    or p_submission_token is null
    or p_submission_token !~ '^[A-Za-z0-9_-]{32,128}$'
    or p_client_note_id is null
    or pg_catalog.char_length(p_client_note_id) not between 10 and 128
  then
    raise exception 'Invalid player link';
  end if;

  v_body := pg_catalog.btrim(
    pg_catalog.regexp_replace(
      coalesce(p_body, ''),
      '[[:space:]]+',
      ' ',
      'g'
    )
  );
  if pg_catalog.char_length(v_body) not between 1 and 240 then
    raise exception 'Note must be between 1 and 240 characters';
  end if;

  select
    editors.owner_id,
    editors.player_key,
    pg_catalog.left(
      coalesce(
        nullif(
          pg_catalog.btrim(shares.snapshot -> 'player' ->> 'name'),
          ''
        ),
        'Player'
      ),
      50
    )
  into v_owner_id, v_player_key, v_player_name
  from public.profit_share_editors as editors
  join public.profit_share_snapshots as shares
    on shares.id = editors.share_id
  where editors.share_id = p_share_id
    and shares.share_mode = 'live'
    and shares.expires_at > v_now
    and editors.submission_token_hash =
      extensions.digest(p_submission_token, 'sha256');

  if v_owner_id is null then
    raise exception 'Invalid or expired player link';
  end if;

  return query
  select
    notes.id,
    notes.player_name,
    notes.body,
    notes.created_at,
    true
  from public.player_team_notes as notes
  where notes.owner_id = v_owner_id
    and notes.player_key = v_player_key
    and notes.client_note_id = p_client_note_id;
  if found then
    return;
  end if;

  delete from public.player_team_notes as notes
  where notes.owner_id = v_owner_id
    and notes.created_at <= v_now - interval '14 days';

  if exists (
    select 1
    from public.player_team_notes as notes
    where notes.owner_id = v_owner_id
      and notes.player_key = v_player_key
      and notes.created_at > v_now - interval '10 seconds'
  ) then
    raise exception 'Wait a few seconds before posting another note';
  end if;

  select pg_catalog.count(*)::integer
  into v_recent_count
  from public.player_team_notes as notes
  where notes.owner_id = v_owner_id
    and notes.player_key = v_player_key
    and notes.created_at > v_now - interval '24 hours';

  if v_recent_count >= 40 then
    raise exception 'Daily note limit reached. Try again later.';
  end if;

  delete from public.player_team_notes as notes
  where notes.id in (
    select oldest.id
    from public.player_team_notes as oldest
    where oldest.owner_id = v_owner_id
    order by oldest.created_at desc
    offset 199
  );

  return query
  insert into public.player_team_notes (
    owner_id,
    player_key,
    player_name,
    client_note_id,
    body,
    created_at
  )
  values (
    v_owner_id,
    v_player_key,
    v_player_name,
    p_client_note_id,
    v_body,
    v_now
  )
  returning
    player_team_notes.id,
    player_team_notes.player_name,
    player_team_notes.body,
    player_team_notes.created_at,
    true;
end;
$$;

revoke all on function public.post_player_team_note(
  text,
  text,
  text,
  text
)
  from public;
grant execute on function public.post_player_team_note(
  text,
  text,
  text,
  text
)
  to anon, authenticated;

create or replace function public.list_player_team_notes()
returns table (
  note_id uuid,
  note_player_key text,
  note_player_name text,
  note_body text,
  note_created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_owner_id uuid := (select auth.uid());
begin
  if v_owner_id is null then
    raise exception 'Cloud account required';
  end if;

  delete from public.player_team_notes as notes
  where notes.owner_id = v_owner_id
    and notes.created_at <= v_now - interval '14 days';

  return query
  select
    notes.id,
    notes.player_key,
    notes.player_name,
    notes.body,
    notes.created_at
  from public.player_team_notes as notes
  where notes.owner_id = v_owner_id
  order by notes.created_at desc
  limit 200;
end;
$$;

revoke all on function public.list_player_team_notes() from public;
revoke execute on function public.list_player_team_notes() from anon;
grant execute on function public.list_player_team_notes()
  to authenticated;

create or replace function public.delete_player_team_note(
  p_note_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_deleted_count integer;
begin
  if v_owner_id is null then
    raise exception 'Cloud account required';
  end if;

  delete from public.player_team_notes as notes
  where notes.id = p_note_id
    and notes.owner_id = v_owner_id;
  get diagnostics v_deleted_count = row_count;
  return v_deleted_count > 0;
end;
$$;

revoke all on function public.delete_player_team_note(uuid) from public;
revoke execute on function public.delete_player_team_note(uuid) from anon;
grant execute on function public.delete_player_team_note(uuid)
  to authenticated;
