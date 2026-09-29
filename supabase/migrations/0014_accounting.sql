-- Accounting module schema. Owns ledger_sync_log (connector sync history) and
-- ledger_account_map (internal key → external account id mapping). Staff/service-
-- role managed: no anon or authenticated access. All reads and writes go through
-- the service-role client in server.ts. Staff RLS policies (forward path) are
-- keyed off public.is_staff(), defined in the admin module migration.
--
-- Depends on: @waltersignal/bananaforce-module-admin (for is_staff()).

create extension if not exists pgcrypto;

-- sync_status enum: guarded with a do-block so the migration is idempotent.
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'sync_status'
      and n.nspname = 'public'
  ) then
    create type public.sync_status as enum (
      'pending',
      'running',
      'succeeded',
      'failed',
      'skipped'
    );
  end if;
end
$$;

-- ledger_sync_log: one row per connector sync attempt.
create table if not exists public.ledger_sync_log (
  id uuid primary key default gen_random_uuid(),
  connector text not null check (connector in ('tiller', 'wave')),
  status public.sync_status not null default 'pending',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  records_synced integer not null default 0,
  error text,
  created_at timestamptz not null default now()
);

comment on table public.ledger_sync_log is
  'Owned by @waltersignal/bananaforce-module-accounting. Ledger sync run history per connector. Staff/service-role managed: no anon or authenticated access. Reads/writes go through the service-role client in server.ts.';

-- ledger_account_map: maps internal account keys to external connector ids.
create table if not exists public.ledger_account_map (
  id uuid primary key default gen_random_uuid(),
  connector text not null check (connector in ('tiller', 'wave')),
  internal_key text not null,
  external_id text not null,
  label text,
  created_at timestamptz not null default now(),
  unique (connector, internal_key)
);

comment on table public.ledger_account_map is
  'Owned by @waltersignal/bananaforce-module-accounting. Maps internal account keys to external connector account IDs. Staff/service-role managed.';

-- Indexes for the most common query patterns.
create index if not exists ledger_sync_log_connector_idx on public.ledger_sync_log (connector);
create index if not exists ledger_sync_log_status_idx on public.ledger_sync_log (status);
create index if not exists ledger_account_map_connector_idx on public.ledger_account_map (connector);

-- Row-level security: enabled on both tables. With no policies for anon or
-- authenticated, every operation is denied by default. The service-role key
-- used in server.ts bypasses RLS.
alter table public.ledger_sync_log enable row level security;
alter table public.ledger_account_map enable row level security;

revoke all on public.ledger_sync_log from anon, authenticated;
revoke all on public.ledger_account_map from anon, authenticated;

-- Staff RLS policies (FORWARD PATH). At MVP runtime these are dormant — server.ts
-- uses the service-role client. They exist so the future session-scoped path
-- needs no new migration. Additive names (accounting_staff_*) cannot clash with
-- other modules. Idempotent: drop before create.

drop policy if exists "accounting_staff_reads_sync_log" on public.ledger_sync_log;
create policy "accounting_staff_reads_sync_log"
  on public.ledger_sync_log
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "accounting_staff_inserts_sync_log" on public.ledger_sync_log;
create policy "accounting_staff_inserts_sync_log"
  on public.ledger_sync_log
  for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "accounting_staff_updates_sync_log" on public.ledger_sync_log;
create policy "accounting_staff_updates_sync_log"
  on public.ledger_sync_log
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "accounting_staff_reads_account_map" on public.ledger_account_map;
create policy "accounting_staff_reads_account_map"
  on public.ledger_account_map
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "accounting_staff_inserts_account_map" on public.ledger_account_map;
create policy "accounting_staff_inserts_account_map"
  on public.ledger_account_map
  for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "accounting_staff_updates_account_map" on public.ledger_account_map;
create policy "accounting_staff_updates_account_map"
  on public.ledger_account_map
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());
