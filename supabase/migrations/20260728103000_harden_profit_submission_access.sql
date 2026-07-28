revoke execute on function public.valid_profit_quantities(jsonb)
  from anon, authenticated;

revoke execute on function public.create_live_profit_share(
  text,
  text,
  text,
  text,
  jsonb
)
  from anon;

revoke execute on function public.enable_profit_submissions(text, text, text)
  from anon;

revoke execute on function public.list_profit_entry_submissions()
  from anon;

revoke execute on function public.review_profit_entry_submission(
  uuid,
  text,
  text,
  jsonb,
  integer,
  date
)
  from anon;

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
begin
  if (select auth.uid()) is null then
    raise exception 'Cloud account required';
  end if;

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
end;
$$;

revoke all on function public.list_profit_entry_submissions() from public;
revoke execute on function public.list_profit_entry_submissions() from anon;
grant execute on function public.list_profit_entry_submissions()
  to authenticated;
