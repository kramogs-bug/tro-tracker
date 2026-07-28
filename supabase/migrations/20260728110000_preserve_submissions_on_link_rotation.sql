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
  v_old_share_id text;
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

  select editors.share_id
  into v_old_share_id
  from public.profit_share_editors as editors
  where editors.owner_id = v_owner_id
    and editors.player_key = p_player_key;

  if v_old_share_id is not null and exists (
    select 1
    from public.profit_entry_submissions as submissions
    where submissions.share_id = v_old_share_id
  ) then
    raise exception
      'Use the latest tracker to preserve existing player submissions';
  end if;

  if v_old_share_id is not null then
    delete from public.profit_share_snapshots
    where id = v_old_share_id;
  end if;

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
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_expires_at timestamptz := v_now + interval '30 days';
  v_owner_id uuid := (select auth.uid());
  v_old_share_id text;
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
    or p_submission_token is null
    or p_submission_token !~ '^[A-Za-z0-9_-]{32,128}$'
  then
    raise exception 'Invalid link token';
  end if;

  if p_snapshot is null
    or pg_catalog.jsonb_typeof(p_snapshot) <> 'object'
    or p_snapshot ->> 'kind' <> 'tro-profit-summary'
    or p_snapshot ->> 'version' <> '1'
    or pg_catalog.octet_length(p_snapshot::text) > 20000
  then
    raise exception 'Invalid profit snapshot';
  end if;

  select editors.share_id
  into v_old_share_id
  from public.profit_share_editors as editors
  where editors.owner_id = v_owner_id
    and editors.player_key = p_player_key;

  if v_old_share_id = p_id then
    raise exception 'New share ID must be unique';
  end if;

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

  if v_old_share_id is not null then
    update public.profit_entry_submissions as submissions
    set share_id = p_id
    where submissions.share_id = v_old_share_id;

    delete from public.profit_share_snapshots
    where id = v_old_share_id;
  end if;

  insert into public.profit_share_editors (
    share_id,
    owner_id,
    player_key,
    token_hash,
    submission_token_hash
  )
  values (
    p_id,
    v_owner_id,
    p_player_key,
    extensions.digest(p_editor_token, 'sha256'),
    extensions.digest(p_submission_token, 'sha256')
  );

  return query
  values (p_id, v_expires_at, v_now);
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
revoke execute on function public.create_live_profit_share(
  text,
  text,
  text,
  text,
  jsonb
)
  from anon;
grant execute on function public.create_live_profit_share(
  text,
  text,
  text,
  text,
  jsonb
)
  to authenticated;

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
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_now timestamptz := pg_catalog.statement_timestamp();
begin
  if v_owner_id is null then
    raise exception 'Cloud account required';
  end if;

  delete from public.profit_entry_submissions as submissions
  where submissions.owner_id = v_owner_id
    and (
      (
        submissions.status <> 'pending'
        and submissions.reviewed_at < v_now - interval '30 days'
      ) or (
        submissions.status = 'pending'
        and submissions.created_at < v_now - interval '60 days'
      )
    );

  delete from public.profit_share_snapshots as shares
  using public.profit_share_editors as editors
  where shares.id = editors.share_id
    and editors.owner_id = v_owner_id
    and shares.expires_at <= v_now
    and not exists (
      select 1
      from public.profit_entry_submissions as submissions
      where submissions.share_id = shares.id
    );

  return query
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
  where submissions.owner_id = v_owner_id
    and (
      submissions.status = 'pending'
      or submissions.reviewed_at > v_now - interval '7 days'
    )
  order by
    case when submissions.status = 'pending' then 0 else 1 end,
    submissions.created_at desc
  limit 200;
end;
$$;

revoke all on function public.list_profit_entry_submissions() from public;
revoke execute on function public.list_profit_entry_submissions() from anon;
grant execute on function public.list_profit_entry_submissions()
  to authenticated;
