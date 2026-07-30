alter table public.profit_entry_submissions
  add column if not exists approved_entry_at timestamptz;

create table if not exists public.profit_submission_evidence (
  submission_id uuid primary key
    references public.profit_entry_submissions(id) on delete cascade,
  owner_id uuid not null
    references auth.users(id) on delete cascade,
  mime_type text not null
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  image_data bytea not null
    check (
      pg_catalog.octet_length(image_data) between 1 and 409600
    ),
  byte_size integer not null
    check (
      byte_size between 1 and 409600
      and byte_size = pg_catalog.octet_length(image_data)
    ),
  created_at timestamptz not null
    default pg_catalog.statement_timestamp()
);

create index if not exists profit_submission_evidence_owner_idx
  on public.profit_submission_evidence (owner_id, created_at desc);

alter table public.profit_submission_evidence enable row level security;

revoke all on table public.profit_submission_evidence from public;
revoke all on table public.profit_submission_evidence
  from anon, authenticated;

create or replace function public.submit_profit_entry_with_evidence(
  p_share_id text,
  p_submission_token text,
  p_client_submission_id text,
  p_quantities jsonb,
  p_shovels integer,
  p_entry_date date,
  p_entry_at timestamptz,
  p_note text,
  p_reference_mime_type text,
  p_reference_base64 text
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
  v_submission_id uuid;
  v_submission_status text;
  v_submission_created_at timestamptz;
  v_owner_id uuid;
  v_image bytea;
  v_owner_evidence_bytes bigint;
begin
  if p_reference_mime_type not in (
    'image/jpeg',
    'image/png',
    'image/webp'
  )
    or p_reference_base64 is null
    or pg_catalog.char_length(p_reference_base64) not between 4 and 550000
  then
    raise exception 'Invalid reference screenshot';
  end if;

  begin
    v_image := pg_catalog.decode(p_reference_base64, 'base64');
  exception when others then
    raise exception 'Invalid reference screenshot';
  end;

  if pg_catalog.octet_length(v_image) not between 1 and 409600 then
    raise exception 'Reference screenshot must be 400 KB or smaller';
  end if;

  select
    submitted.submission_id,
    submitted.submission_status,
    submitted.submission_created_at
  into
    v_submission_id,
    v_submission_status,
    v_submission_created_at
  from public.submit_profit_entry(
    p_share_id,
    p_submission_token,
    p_client_submission_id,
    p_quantities,
    p_shovels,
    p_entry_date,
    p_entry_at,
    p_note
  ) as submitted;

  select submissions.owner_id
  into v_owner_id
  from public.profit_entry_submissions as submissions
  where submissions.id = v_submission_id
    and submissions.share_id = p_share_id
    and submissions.status = 'pending';

  if v_owner_id is null then
    raise exception 'Submission is no longer pending';
  end if;

  select coalesce(pg_catalog.sum(evidence.byte_size), 0)
  into v_owner_evidence_bytes
  from public.profit_submission_evidence as evidence
  where evidence.owner_id = v_owner_id
    and evidence.submission_id <> v_submission_id;

  if v_owner_evidence_bytes + pg_catalog.octet_length(v_image)
    > 20 * 1024 * 1024
  then
    raise exception
      'Temporary screenshot storage is full. Review pending entries or submit without an image.';
  end if;

  insert into public.profit_submission_evidence (
    submission_id,
    owner_id,
    mime_type,
    image_data,
    byte_size
  )
  values (
    v_submission_id,
    v_owner_id,
    p_reference_mime_type,
    v_image,
    pg_catalog.octet_length(v_image)
  )
  on conflict (submission_id) do update
  set
    mime_type = excluded.mime_type,
    image_data = excluded.image_data,
    byte_size = excluded.byte_size,
    created_at = pg_catalog.statement_timestamp();

  return query
  values (
    v_submission_id,
    v_submission_status,
    v_submission_created_at
  );
end;
$$;

revoke all on function public.submit_profit_entry_with_evidence(
  text,
  text,
  text,
  jsonb,
  integer,
  date,
  timestamptz,
  text,
  text,
  text
)
  from public;
grant execute on function public.submit_profit_entry_with_evidence(
  text,
  text,
  text,
  jsonb,
  integer,
  date,
  timestamptz,
  text,
  text,
  text
)
  to anon, authenticated;

create or replace function public.get_profit_submission_evidence(
  p_submission_id uuid
)
returns table (
  reference_mime_type text,
  reference_base64 text,
  reference_size integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
begin
  if v_owner_id is null then
    raise exception 'Cloud account required';
  end if;

  return query
  select
    evidence.mime_type,
    pg_catalog.replace(
      pg_catalog.encode(evidence.image_data, 'base64'),
      pg_catalog.chr(10),
      ''
    ),
    evidence.byte_size
  from public.profit_submission_evidence as evidence
  join public.profit_entry_submissions as submissions
    on submissions.id = evidence.submission_id
  where evidence.submission_id = p_submission_id
    and evidence.owner_id = v_owner_id
    and submissions.owner_id = v_owner_id
    and submissions.status = 'pending';
end;
$$;

revoke all on function public.get_profit_submission_evidence(uuid)
  from public;
revoke execute on function public.get_profit_submission_evidence(uuid)
  from anon;
grant execute on function public.get_profit_submission_evidence(uuid)
  to authenticated;

create or replace function public.review_profit_entry_submission(
  p_submission_id uuid,
  p_status text,
  p_review_note text,
  p_approved_quantities jsonb,
  p_approved_shovels integer,
  p_approved_entry_date date,
  p_approved_entry_at timestamptz
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
  v_owner_id uuid := (select auth.uid());
  v_quantities jsonb;
begin
  if v_owner_id is null then
    raise exception 'Cloud account required';
  end if;

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
      or p_approved_entry_at is null
      or p_approved_entry_at < v_now - interval '31 days'
      or p_approved_entry_at > v_now + interval '1 day'
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
    review_note = pg_catalog.left(coalesce(p_review_note, ''), 200),
    approved_quantities =
      case when p_status = 'approved' then v_quantities else null end,
    approved_shovels =
      case when p_status = 'approved' then p_approved_shovels else null end,
    approved_entry_date =
      case when p_status = 'approved' then p_approved_entry_date else null end,
    approved_entry_at =
      case when p_status = 'approved' then p_approved_entry_at else null end,
    reviewed_at = v_now
  where submissions.id = p_submission_id
    and submissions.owner_id = v_owner_id
    and submissions.status = 'pending'
  returning submissions.id, submissions.status, submissions.reviewed_at;

  if found then
    delete from public.profit_submission_evidence as evidence
    where evidence.submission_id = p_submission_id
      and evidence.owner_id = v_owner_id;
    return;
  end if;

  delete from public.profit_submission_evidence as evidence
  using public.profit_entry_submissions as submissions
  where evidence.submission_id = p_submission_id
    and submissions.id = evidence.submission_id
    and evidence.owner_id = v_owner_id
    and submissions.owner_id = v_owner_id
    and submissions.status = p_status;

  return query
  select submissions.id, submissions.status, submissions.reviewed_at
  from public.profit_entry_submissions as submissions
  where submissions.id = p_submission_id
    and submissions.owner_id = v_owner_id
    and submissions.status = p_status;
end;
$$;

revoke all on function public.review_profit_entry_submission(
  uuid,
  text,
  text,
  jsonb,
  integer,
  date,
  timestamptz
)
  from public;
revoke execute on function public.review_profit_entry_submission(
  uuid,
  text,
  text,
  jsonb,
  integer,
  date,
  timestamptz
)
  from anon;
grant execute on function public.review_profit_entry_submission(
  uuid,
  text,
  text,
  jsonb,
  integer,
  date,
  timestamptz
)
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
  v_approved_entry_at timestamptz;
begin
  select submissions.entry_at
  into v_approved_entry_at
  from public.profit_entry_submissions as submissions
  where submissions.id = p_submission_id
    and submissions.owner_id = (select auth.uid());

  return query
  select reviewed.submission_id,
    reviewed.submission_status,
    reviewed.submission_reviewed_at
  from public.review_profit_entry_submission(
    p_submission_id,
    p_status,
    p_review_note,
    p_approved_quantities,
    p_approved_shovels,
    p_approved_entry_date,
    v_approved_entry_at
  ) as reviewed;
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
revoke execute on function public.review_profit_entry_submission(
  uuid,
  text,
  text,
  jsonb,
  integer,
  date
)
  from anon;
grant execute on function public.review_profit_entry_submission(
  uuid,
  text,
  text,
  jsonb,
  integer,
  date
)
  to authenticated;

drop function public.get_player_profit_submissions(text, text);

create function public.get_player_profit_submissions(
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
  submission_approved_entry_at timestamptz,
  submission_has_reference_image boolean,
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
    submissions.approved_entry_at,
    exists (
      select 1
      from public.profit_submission_evidence as evidence
      where evidence.submission_id = submissions.id
    ),
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

drop function public.list_profit_entry_submissions();

create function public.list_profit_entry_submissions()
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
  submission_approved_entry_at timestamptz,
  submission_has_reference_image boolean,
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
    submissions.approved_entry_at,
    exists (
      select 1
      from public.profit_submission_evidence as evidence
      where evidence.submission_id = submissions.id
    ),
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
