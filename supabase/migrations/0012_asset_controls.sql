-- Asset controls module schema. Owns three tables: assets (the asset register),
-- asset_assignments (check-out/check-in history), and asset_maintenance (service
-- log). Staff/service-role managed: no anon or authenticated access. All reads
-- and writes go through the service-role client in server.ts. The staff-session
-- forward path uses additive asset_controls_staff_* RLS policies keyed off
-- public.is_staff() (defined in 0001_admin.sql, which must be applied first).

create extension if not exists pgcrypto;

-- asset_kind enum (guarded do-block so the migration is idempotent)
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'asset_kind'
      and n.nspname = 'public'
  ) then
    create type public.asset_kind as enum ('computer', 'vehicle', 'tool');
  end if;
end
$$;

-- asset_status enum (guarded do-block)
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'asset_status'
      and n.nspname = 'public'
  ) then
    create type public.asset_status as enum (
      'available',
      'assigned',
      'maintenance',
      'retired'
    );
  end if;
end
$$;

create table if not exists public.assets (
  id           uuid primary key default gen_random_uuid(),
  kind         public.asset_kind not null,
  name         text not null,
  serial       text,
  status       public.asset_status not null default 'available',
  purchase_date date,
  value        numeric(12,2),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.asset_assignments (
  id             uuid primary key default gen_random_uuid(),
  asset_id       uuid not null references public.assets(id) on delete cascade,
  assignee       uuid not null,
  location       text,
  checked_out_at timestamptz not null default now(),
  due_back       date,
  returned_at    timestamptz,
  created_at     timestamptz not null default now()
);

create table if not exists public.asset_maintenance (
  id           uuid primary key default gen_random_uuid(),
  asset_id     uuid not null references public.assets(id) on delete cascade,
  performed_at timestamptz not null default now(),
  type         text,
  notes        text,
  cost         numeric(12,2),
  created_at   timestamptz not null default now()
);

create index if not exists asset_controls_assets_status_idx
  on public.assets (status);
create index if not exists asset_controls_assets_kind_idx
  on public.assets (kind);
create index if not exists asset_controls_assignments_asset_id_idx
  on public.asset_assignments (asset_id);
create index if not exists asset_controls_assignments_returned_at_idx
  on public.asset_assignments (returned_at);

-- At most ONE open (not-yet-returned) assignment per asset. This is the
-- race-safe guarantee against a double check-out: a concurrent second open
-- assignment fails the unique violation at the DB layer, so the register can
-- never show one asset checked out to two people. The app pre-checks for a
-- clean 409, but this index is the backstop that holds under concurrency.
create unique index if not exists asset_controls_assignments_one_open_per_asset
  on public.asset_assignments (asset_id)
  where returned_at is null;
create index if not exists asset_controls_maintenance_asset_id_idx
  on public.asset_maintenance (asset_id);

-- Keep assets.updated_at current on every mutation. Module-scoped function name
-- so it can't clash with another module's trigger function.
create or replace function public.asset_controls_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists asset_controls_assets_set_updated_at on public.assets;
create trigger asset_controls_assets_set_updated_at
  before update on public.assets
  for each row execute function public.asset_controls_set_updated_at();

comment on table public.assets is
  'Owned by @waltersignal/bananaforce-module-asset-controls. Asset register. Staff/service-role managed: no anon or authenticated access. Reads/writes go through the service-role client in server.ts.';
comment on table public.asset_assignments is
  'Owned by @waltersignal/bananaforce-module-asset-controls. Check-out/check-in history. returned_at null = currently checked out. Staff/service-role managed.';
comment on table public.asset_maintenance is
  'Owned by @waltersignal/bananaforce-module-asset-controls. Maintenance event log. Staff/service-role managed.';

alter table public.assets enable row level security;
alter table public.asset_assignments enable row level security;
alter table public.asset_maintenance enable row level security;

revoke all on public.assets from anon, authenticated;
revoke all on public.asset_assignments from anon, authenticated;
revoke all on public.asset_maintenance from anon, authenticated;

-- ===========================================================================
-- Staff-scoped RLS policies (FORWARD PATH).
--
-- At MVP runtime the service-role client (used by server.ts) bypasses RLS, so
-- these policies are dormant. They exist so the future staff-session path needs
-- no new migration — it becomes a config change: swap service-role for a
-- session-scoped client and these policies become the enforcement boundary.
--
-- Each policy is additive (prefixed asset_controls_staff_*) and idempotent
-- (drop if exists before create). Mirror of 0001_admin.sql's pattern.
-- ===========================================================================

-- assets: staff may read, insert, and update.

drop policy if exists "asset_controls_staff_reads_assets" on public.assets;
create policy "asset_controls_staff_reads_assets"
  on public.assets
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "asset_controls_staff_inserts_assets" on public.assets;
create policy "asset_controls_staff_inserts_assets"
  on public.assets
  for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "asset_controls_staff_updates_assets" on public.assets;
create policy "asset_controls_staff_updates_assets"
  on public.assets
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- asset_assignments: staff may read, insert, and update (to stamp returned_at).

drop policy if exists "asset_controls_staff_reads_assignments" on public.asset_assignments;
create policy "asset_controls_staff_reads_assignments"
  on public.asset_assignments
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "asset_controls_staff_inserts_assignments" on public.asset_assignments;
create policy "asset_controls_staff_inserts_assignments"
  on public.asset_assignments
  for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "asset_controls_staff_updates_assignments" on public.asset_assignments;
create policy "asset_controls_staff_updates_assignments"
  on public.asset_assignments
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- asset_maintenance: staff may read and insert maintenance records.

drop policy if exists "asset_controls_staff_reads_maintenance" on public.asset_maintenance;
create policy "asset_controls_staff_reads_maintenance"
  on public.asset_maintenance
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "asset_controls_staff_inserts_maintenance" on public.asset_maintenance;
create policy "asset_controls_staff_inserts_maintenance"
  on public.asset_maintenance
  for insert
  to authenticated
  with check (public.is_staff());
