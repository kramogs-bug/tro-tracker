alter table public.profit_share_snapshots
  alter column expires_at
  set default (pg_catalog.statement_timestamp() + interval '30 days');

update public.profit_share_snapshots
set expires_at = created_at + interval '30 days'
where expires_at > created_at + interval '30 days';
