alter table public.tracker_states
  add column if not exists revision bigint not null default 0,
  add column if not exists writer_id text not null default '';

create or replace function public.set_tracker_state_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = statement_timestamp();
  if tg_op = 'INSERT' then
    new.revision = 1;
  else
    new.revision = old.revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists set_tracker_state_metadata on public.tracker_states;
create trigger set_tracker_state_metadata
before insert or update on public.tracker_states
for each row execute function public.set_tracker_state_metadata();

create or replace function public.save_tracker_state(
  p_expected_revision bigint,
  p_data jsonb,
  p_writer_id text
)
returns table (
  state_data jsonb,
  state_revision bigint,
  state_writer_id text,
  state_updated_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  update public.tracker_states as tracker
  set
    data = p_data,
    writer_id = left(coalesce(p_writer_id, ''), 128)
  where tracker.user_id = (select auth.uid())
    and tracker.revision = p_expected_revision
  returning
    tracker.data,
    tracker.revision,
    tracker.writer_id,
    tracker.updated_at;
$$;

revoke all on function public.save_tracker_state(bigint, jsonb, text)
  from public;
grant execute on function public.save_tracker_state(bigint, jsonb, text)
  to authenticated;

alter table public.tracker_states replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.tracker_states;
exception
  when duplicate_object then null;
end;
$$;
