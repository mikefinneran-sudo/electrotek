-- Accounting module: outbox queue, entity map, connector credentials, sync log extensions.
-- Depends on: 0014_accounting.sql, @waltersignal/bananaforce-module-admin (is_staff()).

-- outbox_status enum (idempotent).
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'outbox_status'
      and n.nspname = 'public'
  ) then
    create type public.outbox_status as enum (
      'pending',
      'processing',
      'done',
      'failed'
    );
  end if;
end
$$;

alter table public.ledger_sync_log
  add column if not exists direction text
    check (direction is null or direction in ('inbound', 'outbound'));

alter table public.ledger_sync_log
  add column if not exists trigger_source text
    check (trigger_source is null or trigger_source in ('manual', 'event', 'cron'));

alter table public.ledger_sync_log
  add column if not exists idempotency_key text;

create index if not exists ledger_sync_log_idempotency_idx
  on public.ledger_sync_log (idempotency_key)
  where idempotency_key is not null;

create table if not exists public.ledger_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  source_module text not null,
  source_id text not null,
  payload jsonb not null default '{}',
  status public.outbox_status not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (idempotency_key)
);

comment on table public.ledger_outbox is
  'Owned by @waltersignal/bananaforce-module-accounting. Domain events for outbound ledger sync. Staff/service-role managed.';

create index if not exists ledger_outbox_status_idx on public.ledger_outbox (status);
create index if not exists ledger_outbox_created_idx on public.ledger_outbox (created_at);

create table if not exists public.ledger_entity_map (
  id uuid primary key default gen_random_uuid(),
  connector text not null check (connector in ('tiller', 'wave')),
  entity_type text not null check (
    entity_type in ('invoice', 'customer', 'payment', 'order')
  ),
  internal_id text not null,
  external_id text not null,
  created_at timestamptz not null default now(),
  unique (connector, entity_type, internal_id)
);

comment on table public.ledger_entity_map is
  'Owned by @waltersignal/bananaforce-module-accounting. Maps BananaFORCE entity ids to Tiller/Wave ids.';

create index if not exists ledger_entity_map_connector_idx
  on public.ledger_entity_map (connector, entity_type);

create table if not exists public.connector_credentials (
  id uuid primary key default gen_random_uuid(),
  connector text not null check (connector in ('tiller', 'wave')),
  credentials_encrypted text not null,
  connected_at timestamptz not null default now(),
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (connector)
);

comment on table public.connector_credentials is
  'Owned by @waltersignal/bananaforce-module-accounting. Encrypted connector OAuth credentials.';

alter table public.ledger_outbox enable row level security;
alter table public.ledger_entity_map enable row level security;
alter table public.connector_credentials enable row level security;

revoke all on public.ledger_outbox from anon, authenticated;
revoke all on public.ledger_entity_map from anon, authenticated;
revoke all on public.connector_credentials from anon, authenticated;

drop policy if exists "accounting_staff_reads_outbox" on public.ledger_outbox;
create policy "accounting_staff_reads_outbox"
  on public.ledger_outbox for select to authenticated
  using (public.is_staff());

drop policy if exists "accounting_staff_writes_outbox" on public.ledger_outbox;
create policy "accounting_staff_writes_outbox"
  on public.ledger_outbox for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "accounting_staff_reads_entity_map" on public.ledger_entity_map;
create policy "accounting_staff_reads_entity_map"
  on public.ledger_entity_map for select to authenticated
  using (public.is_staff());

drop policy if exists "accounting_staff_writes_entity_map" on public.ledger_entity_map;
create policy "accounting_staff_writes_entity_map"
  on public.ledger_entity_map for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "accounting_staff_reads_credentials" on public.connector_credentials;
create policy "accounting_staff_reads_credentials"
  on public.connector_credentials for select to authenticated
  using (public.is_staff());

drop policy if exists "accounting_staff_writes_credentials" on public.connector_credentials;
create policy "accounting_staff_writes_credentials"
  on public.connector_credentials for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());
