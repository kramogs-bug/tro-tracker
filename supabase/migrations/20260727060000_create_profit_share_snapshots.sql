create table if not exists public.profit_share_snapshots (
  id text primary key
    check (id ~ '^[A-Za-z0-9_-]{10,16}$'),
  snapshot jsonb not null
    check (
      pg_catalog.jsonb_typeof(snapshot) = 'object'
      and pg_catalog.octet_length(snapshot::text) <= 20000
    ),
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  expires_at timestamptz not null
    default (pg_catalog.statement_timestamp() + interval '180 days')
);

create index if not exists profit_share_snapshots_expires_at_idx
  on public.profit_share_snapshots (expires_at);

alter table public.profit_share_snapshots enable row level security;

drop policy if exists "Anyone can read active profit shares"
  on public.profit_share_snapshots;
create policy "Anyone can read active profit shares"
  on public.profit_share_snapshots
  for select
  to anon, authenticated
  using (expires_at > pg_catalog.statement_timestamp());

revoke all on table public.profit_share_snapshots from public;
revoke all on table public.profit_share_snapshots from anon, authenticated;
grant select on table public.profit_share_snapshots to anon, authenticated;

create or replace function public.create_profit_share(
  p_id text,
  p_snapshot jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{10,16}$' then
    raise exception 'Invalid share ID';
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
  where expires_at <= pg_catalog.statement_timestamp();

  insert into public.profit_share_snapshots (id, snapshot)
  values (p_id, p_snapshot);

  return p_id;
end;
$$;

revoke all on function public.create_profit_share(text, jsonb) from public;
grant execute on function public.create_profit_share(text, jsonb)
  to anon, authenticated;
