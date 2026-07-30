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
  on conflict on constraint profit_submission_evidence_pkey do update
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
