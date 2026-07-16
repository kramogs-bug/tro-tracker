create table if not exists public.tracker_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"players":[],"transactions":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.tracker_states enable row level security;

drop policy if exists "Users can read their own tracker" on public.tracker_states;
create policy "Users can read their own tracker"
  on public.tracker_states for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own tracker" on public.tracker_states;
create policy "Users can create their own tracker"
  on public.tracker_states for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own tracker" on public.tracker_states;
create policy "Users can update their own tracker"
  on public.tracker_states for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own tracker" on public.tracker_states;
create policy "Users can delete their own tracker"
  on public.tracker_states for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.tracker_states to authenticated;
