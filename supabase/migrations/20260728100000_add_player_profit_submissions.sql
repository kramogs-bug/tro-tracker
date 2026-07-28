alter table public.profit_share_editors
  add column if not exists submission_token_hash bytea
    check (
      submission_token_hash is null
      or pg_catalog.octet_length(submission_token_hash) = 32
    );

create table if not exists public.profit_entry_submissions (
  id uuid primary key default extensions.gen_random_uuid(),
  share_id text not null
    references public.profit_share_snapshots(id) on delete cascade,
  owner_id uuid not null
    references auth.users(id) on delete cascade,
  player_key text not null
    check (pg_catalog.char_length(player_key) between 1 and 128),
  client_submission_id text not null
    check (pg_catalog.char_length(client_submission_id) between 10 and 128),
  quantities jsonb not null,
  shovels integer not null default 0
    check (shovels between 0 and 9999999),
  entry_date date not null,
  entry_at timestamptz not null,
  note text not null default ''
    check (pg_catalog.char_length(note) <= 200),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  review_note text not null default ''
    check (pg_catalog.char_length(review_note) <= 200),
  approved_quantities jsonb,
  approved_shovels integer
    check (
      approved_shovels is null
      or approved_shovels between 0 and 9999999
    ),
  approved_entry_date date,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  reviewed_at timestamptz,
  unique (share_id, client_submission_id)
);

create index if not exists profit_entry_submissions_owner_status_idx
  on public.profit_entry_submissions (owner_id, status, created_at desc);

create index if not exists profit_entry_submissions_share_created_idx
  on public.profit_entry_submissions (share_id, created_at desc);

alter table public.profit_entry_submissions enable row level security;

revoke all on table public.profit_entry_submissions from public;
revoke all on table public.profit_entry_submissions
  from anon, authenticated;

create or replace function public.valid_profit_quantities(
  p_quantities jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item text;
  v_value text;
begin
  if p_quantities is null
    or pg_catalog.jsonb_typeof(p_quantities) <> 'object'
  then
    return false;
  end if;

  foreach v_item in array array[
    'Tro',
    'Aero',
    'Sand Dollar',
    'Scallop',
    'Starfish'
  ]
  loop
    if not (p_quantities ? v_item) then
      return false;
    end if;
    v_value := p_quantities ->> v_item;
    if v_value is null or v_value !~ '^(0|[1-9][0-9]{0,6})$' then
      return false;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_quantities) as keys(item)
    where keys.item not in (
      'Tro',
      'Aero',
      'Sand Dollar',
      'Scallop',
      'Starfish'
    )
  ) then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.valid_profit_quantities(jsonb) from public;

create or replace function public.create_live_profit_share(
  p_id text,
  p_player_key text,
  p_editor_token text,
  p_submission_token text,
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
begin
  if p_submission_token is null
    or p_submission_token !~ '^[A-Za-z0-9_-]{32,128}$'
  then
    raise exception 'Invalid submission token';
  end if;

  perform *
  from public.create_live_profit_share(
    p_id,
    p_player_key,
    p_editor_token,
    p_snapshot
  );

  update public.profit_share_editors as editors
  set submission_token_hash =
    extensions.digest(p_submission_token, 'sha256')
  where editors.share_id = p_id;

  return query
  select shares.id, shares.expires_at, shares.updated_at
  from public.profit_share_snapshots as shares
  where shares.id = p_id;
end;
$$;

revoke all on function public.create_live_profit_share(
  text,
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
  text,
  jsonb
)
  to authenticated;

create or replace function public.enable_profit_submissions(
  p_id text,
  p_editor_token text,
  p_submission_token text
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
  if (select auth.uid()) is null then
    raise exception 'Cloud account required';
  end if;

  if p_submission_token is null
    or p_submission_token !~ '^[A-Za-z0-9_-]{32,128}$'
  then
    raise exception 'Invalid submission token';
  end if;

  update public.profit_share_editors as editors
  set submission_token_hash =
    extensions.digest(p_submission_token, 'sha256')
  from public.profit_share_snapshots as shares
  where editors.share_id = p_id
    and shares.id = editors.share_id
    and shares.share_mode = 'live'
    and shares.expires_at > v_now
    and editors.owner_id = (select auth.uid())
    and editors.token_hash =
      extensions.digest(p_editor_token, 'sha256');

  if not found then
    raise exception 'Live profit link not found';
  end if;

  return query
  select shares.id, shares.expires_at, shares.updated_at
  from public.profit_share_snapshots as shares
  where shares.id = p_id;
end;
$$;

revoke all on function public.enable_profit_submissions(text, text, text)
  from public;
grant execute on function public.enable_profit_submissions(text, text, text)
  to authenticated;

create or replace function public.submit_profit_entry(
  p_share_id text,
  p_submission_token text,
  p_client_submission_id text,
  p_quantities jsonb,
  p_shovels integer,
  p_entry_date date,
  p_entry_at timestamptz,
  p_note text
)
returns table (
  submission_id uuid,
  submission_status text,
  submission_created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_owner_id uuid;
  v_player_key text;
  v_recent_count integer;
  v_pending_count integer;
  v_quantities jsonb;
begin
  if p_share_id is null
    or p_share_id !~ '^[A-Za-z0-9_-]{10,16}$'
    or p_submission_token is null
    or p_submission_token !~ '^[A-Za-z0-9_-]{32,128}$'
  then
    raise exception 'Invalid player link';
  end if;

  if p_client_submission_id is null
    or pg_catalog.char_length(p_client_submission_id) not between 10 and 128
    or not public.valid_profit_quantities(p_quantities)
    or p_shovels is null
    or p_shovels not between 0 and 9999999
  then
    raise exception 'Invalid entry quantities';
  end if;

  if (
    (p_quantities ->> 'Tro')::integer
    + (p_quantities ->> 'Aero')::integer
    + (p_quantities ->> 'Sand Dollar')::integer
    + (p_quantities ->> 'Scallop')::integer
    + (p_quantities ->> 'Starfish')::integer
    + p_shovels
  ) <= 0 then
    raise exception 'Entry is empty';
  end if;

  if p_entry_date < current_date - 30
    or p_entry_date > current_date + 1
    or p_entry_at < v_now - interval '31 days'
    or p_entry_at > v_now + interval '1 day'
    or pg_catalog.char_length(coalesce(p_note, '')) > 200
  then
    raise exception 'Invalid entry date or note';
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
    submissions.id,
    submissions.status,
    submissions.created_at
  from public.profit_entry_submissions as submissions
  where submissions.share_id = p_share_id
    and submissions.client_submission_id = p_client_submission_id;
  if found then
    return;
  end if;

  delete from public.profit_entry_submissions as submissions
  where (
    submissions.status <> 'pending'
    and submissions.reviewed_at < v_now - interval '30 days'
  ) or (
    submissions.status = 'pending'
    and submissions.created_at < v_now - interval '60 days'
  );

  select pg_catalog.count(*)::integer
  into v_recent_count
  from public.profit_entry_submissions as submissions
  where submissions.share_id = p_share_id
    and submissions.created_at > v_now - interval '10 minutes';

  select pg_catalog.count(*)::integer
  into v_pending_count
  from public.profit_entry_submissions as submissions
  where submissions.share_id = p_share_id
    and submissions.status = 'pending';

  if v_recent_count >= 10 or v_pending_count >= 50 then
    raise exception 'Submission limit reached. Try again later.';
  end if;

  v_quantities := pg_catalog.jsonb_build_object(
    'Tro', (p_quantities ->> 'Tro')::integer,
    'Aero', (p_quantities ->> 'Aero')::integer,
    'Sand Dollar', (p_quantities ->> 'Sand Dollar')::integer,
    'Scallop', (p_quantities ->> 'Scallop')::integer,
    'Starfish', (p_quantities ->> 'Starfish')::integer
  );

  return query
  insert into public.profit_entry_submissions (
    share_id,
    owner_id,
    player_key,
    client_submission_id,
    quantities,
    shovels,
    entry_date,
    entry_at,
    note
  )
  values (
    p_share_id,
    v_owner_id,
    v_player_key,
    p_client_submission_id,
    v_quantities,
    p_shovels,
    p_entry_date,
    p_entry_at,
    pg_catalog.left(coalesce(p_note, ''), 200)
  )
  returning
    profit_entry_submissions.id,
    profit_entry_submissions.status,
    profit_entry_submissions.created_at;
end;
$$;

revoke all on function public.submit_profit_entry(
  text,
  text,
  text,
  jsonb,
  integer,
  date,
  timestamptz,
  text
)
  from public;
grant execute on function public.submit_profit_entry(
  text,
  text,
  text,
  jsonb,
  integer,
  date,
  timestamptz,
  text
)
  to anon, authenticated;

create or replace function public.get_player_profit_submissions(
  p_share_id text,
  p_submission_token text
)
returns table (
  submission_id uuid,
  submission_quantities jsonb,
  submission_shovels integer,
  submission_entry_date date,
  submission_entry_at timestamptz,
  submission_note text,
  submission_status text,
  submission_review_note text,
  submission_approved_quantities jsonb,
  submission_approved_shovels integer,
  submission_approved_entry_date date,
  submission_created_at timestamptz,
  submission_reviewed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    submissions.id,
    submissions.quantities,
    submissions.shovels,
    submissions.entry_date,
    submissions.entry_at,
    submissions.note,
    submissions.status,
    submissions.review_note,
    submissions.approved_quantities,
    submissions.approved_shovels,
    submissions.approved_entry_date,
    submissions.created_at,
    submissions.reviewed_at
  from public.profit_entry_submissions as submissions
  join public.profit_share_editors as editors
    on editors.share_id = submissions.share_id
  join public.profit_share_snapshots as shares
    on shares.id = editors.share_id
  where submissions.share_id = p_share_id
    and shares.share_mode = 'live'
    and shares.expires_at > pg_catalog.statement_timestamp()
    and editors.submission_token_hash =
      extensions.digest(p_submission_token, 'sha256')
    and (
      submissions.status = 'pending'
      or submissions.reviewed_at >
        pg_catalog.statement_timestamp() - interval '7 days'
    )
  order by submissions.created_at desc
  limit 50;
$$;

revoke all on function public.get_player_profit_submissions(text, text)
  from public;
grant execute on function public.get_player_profit_submissions(text, text)
  to anon, authenticated;

create or replace function public.list_profit_entry_submissions()
returns table (
  submission_id uuid,
  submission_share_id text,
  submission_player_key text,
  submission_quantities jsonb,
  submission_shovels integer,
  submission_entry_date date,
  submission_entry_at timestamptz,
  submission_note text,
  submission_status text,
  submission_review_note text,
  submission_approved_quantities jsonb,
  submission_approved_shovels integer,
  submission_approved_entry_date date,
  submission_created_at timestamptz,
  submission_reviewed_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select
    submissions.id,
    submissions.share_id,
    submissions.player_key,
    submissions.quantities,
    submissions.shovels,
    submissions.entry_date,
    submissions.entry_at,
    submissions.note,
    submissions.status,
    submissions.review_note,
    submissions.approved_quantities,
    submissions.approved_shovels,
    submissions.approved_entry_date,
    submissions.created_at,
    submissions.reviewed_at
  from public.profit_entry_submissions as submissions
  where submissions.owner_id = (select auth.uid())
    and (
      submissions.status = 'pending'
      or submissions.reviewed_at >
        pg_catalog.statement_timestamp() - interval '7 days'
    )
  order by
    case when submissions.status = 'pending' then 0 else 1 end,
    submissions.created_at desc
  limit 200;
$$;

revoke all on function public.list_profit_entry_submissions() from public;
grant execute on function public.list_profit_entry_submissions()
  to authenticated;

create or replace function public.review_profit_entry_submission(
  p_submission_id uuid,
  p_status text,
  p_review_note text,
  p_approved_quantities jsonb,
  p_approved_shovels integer,
  p_approved_entry_date date
)
returns table (
  submission_id uuid,
  submission_status text,
  submission_reviewed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_quantities jsonb;
begin
  if p_status not in ('approved', 'rejected')
    or pg_catalog.char_length(coalesce(p_review_note, '')) > 200
  then
    raise exception 'Invalid review';
  end if;

  if p_status = 'approved' then
    if not public.valid_profit_quantities(p_approved_quantities)
      or p_approved_shovels is null
      or p_approved_shovels not between 0 and 9999999
      or p_approved_entry_date < current_date - 30
      or p_approved_entry_date > current_date + 1
    then
      raise exception 'Invalid approved entry';
    end if;
    if (
      (p_approved_quantities ->> 'Tro')::integer
      + (p_approved_quantities ->> 'Aero')::integer
      + (p_approved_quantities ->> 'Sand Dollar')::integer
      + (p_approved_quantities ->> 'Scallop')::integer
      + (p_approved_quantities ->> 'Starfish')::integer
      + p_approved_shovels
    ) <= 0 then
      raise exception 'Approved entry is empty';
    end if;
    v_quantities := pg_catalog.jsonb_build_object(
      'Tro', (p_approved_quantities ->> 'Tro')::integer,
      'Aero', (p_approved_quantities ->> 'Aero')::integer,
      'Sand Dollar',
        (p_approved_quantities ->> 'Sand Dollar')::integer,
      'Scallop', (p_approved_quantities ->> 'Scallop')::integer,
      'Starfish', (p_approved_quantities ->> 'Starfish')::integer
    );
  end if;

  return query
  update public.profit_entry_submissions as submissions
  set
    status = p_status,
    review_note = pg_catalog.left(
      coalesce(p_review_note, ''),
      200
    ),
    approved_quantities =
      case when p_status = 'approved' then v_quantities else null end,
    approved_shovels =
      case when p_status = 'approved' then p_approved_shovels else null end,
    approved_entry_date =
      case when p_status = 'approved' then p_approved_entry_date else null end,
    reviewed_at = v_now
  where submissions.id = p_submission_id
    and submissions.owner_id = (select auth.uid())
    and submissions.status = 'pending'
  returning submissions.id, submissions.status, submissions.reviewed_at;

  if found then
    return;
  end if;

  return query
  select submissions.id, submissions.status, submissions.reviewed_at
  from public.profit_entry_submissions as submissions
  where submissions.id = p_submission_id
    and submissions.owner_id = (select auth.uid())
    and submissions.status = p_status;
end;
$$;

revoke all on function public.review_profit_entry_submission(
  uuid,
  text,
  text,
  jsonb,
  integer,
  date
)
  from public;
grant execute on function public.review_profit_entry_submission(
  uuid,
  text,
  text,
  jsonb,
  integer,
  date
)
  to authenticated;
