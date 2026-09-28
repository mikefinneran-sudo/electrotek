-- Scheduling module schema. Owns three tables that drive the service-ops
-- scheduling layer: work_orders (the central job record), scheduled_visits
-- (recurring visit templates), and crew_assignments (who is on each job).
-- This migration is self-contained — it does NOT alter any table owned by
-- another module. The optional FK references public.inspections(id) (owned by
-- module-quote-engine); that module must be applied first if inspections exist.
--
-- RUNTIME PATH: all reads/writes go through the service-role client in
-- server.ts (RLS bypassed, deny-by-default authorize gate in routes.ts).
--
-- FORWARD PATH: is_staff()-keyed scheduling_staff_* policies are the future
-- once staff sign in with their own Supabase Auth session. They are defined
-- here so the forward path is a config change, not a new migration. Apply the
-- admin module (0001_admin.sql) before this — it owns public.is_staff().

create extension if not exists pgcrypto;

-- work_order_status enum, guarded by the same do-block idiom as inspection_status.
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'work_order_status'
      and n.nspname = 'public'
  ) then
    create type public.work_order_status as enum (
      'scheduled',
      'in_progress',
      'completed',
      'cancelled'
    );
  end if;
end
$$;

-- Central job/work-order record. inspection_id is optional: a work order can
-- be created independently of a quote-engine inspection (e.g. a recurring
-- maintenance job) or linked to an existing inspection on acceptance.
create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid references public.inspections(id) on delete set null,
  title text not null,
  description text,
  status public.work_order_status not null default 'scheduled',
  scheduled_for timestamptz,
  location text,
  assigned_to uuid, -- staff/crew member; NULL = unassigned; no FK (no staff table self-ref needed)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.work_orders is
  'Owned by @waltersignal/bananaforce-module-scheduling. The central job/work-order record. Staff/service-role managed: no anon or authenticated access until scheduling_staff_* policies are activated. Reads/writes go through the service-role client in server.ts.';

-- Recurring visit template. Expands into concrete visit dates via
-- src/recurrence.ts. One work order can have multiple recurring templates
-- (e.g. different areas with different frequencies).
create table if not exists public.scheduled_visits (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  inspection_id uuid references public.inspections(id) on delete set null,
  frequency text, -- e.g. 'weekly', 'biweekly', 'daily'
  visits_per_week numeric,
  cleaning_days text, -- comma-separated short day names, e.g. 'Mon,Wed,Fri'
  recurs_from date,
  recurs_until date,
  created_at timestamptz not null default now()
);

comment on table public.scheduled_visits is
  'Owned by @waltersignal/bananaforce-module-scheduling. Recurring visit template that expands into concrete visit dates via recurrence.ts. Cascades on work_order deletion. Staff/service-role managed.';

-- Crew assignment. Unique per (work_order, assignee) so upsert is idempotent.
create table if not exists public.crew_assignments (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  assignee uuid not null, -- staff/crew member uuid
  role text,
  assigned_at timestamptz not null default now(),
  unique (work_order_id, assignee)
);

comment on table public.crew_assignments is
  'Owned by @waltersignal/bananaforce-module-scheduling. Crew assignment per work order, unique on (work_order_id, assignee). Cascades on work_order deletion. Staff/service-role managed.';

-- Indexes for common query patterns.
create index if not exists work_orders_status_idx on public.work_orders (status);
create index if not exists work_orders_scheduled_for_idx on public.work_orders (scheduled_for);
create index if not exists scheduled_visits_work_order_id_idx on public.scheduled_visits (work_order_id);
create index if not exists crew_assignments_work_order_id_idx on public.crew_assignments (work_order_id);

-- Keep work_orders.updated_at current on every mutation. Module-scoped function
-- name so it cannot clash with another module's trigger function.
create or replace function public.scheduling_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists scheduling_work_orders_set_updated_at on public.work_orders;
create trigger scheduling_work_orders_set_updated_at
  before update on public.work_orders
  for each row execute function public.scheduling_set_updated_at();

-- ===========================================================================
-- RLS + revoke. All three tables are staff/service-role managed: revoke all
-- access from anon and authenticated so every request is denied by default.
-- The service-role client in server.ts bypasses RLS at runtime.
-- ===========================================================================

alter table public.work_orders enable row level security;
alter table public.scheduled_visits enable row level security;
alter table public.crew_assignments enable row level security;

revoke all on public.work_orders from anon, authenticated;
revoke all on public.scheduled_visits from anon, authenticated;
revoke all on public.crew_assignments from anon, authenticated;

-- ===========================================================================
-- FORWARD PATH: staff-scoped RLS policies keyed off public.is_staff().
-- These are additive (scheduling_staff_* names, drop-if-exists idempotent)
-- and are dormant at MVP runtime (service-role client is used). They activate
-- once staff sign in with a Supabase Auth session instead of the service-role
-- key. The admin module must be applied before this migration for is_staff()
-- to exist.
-- ===========================================================================

-- work_orders: staff select / insert / update.

drop policy if exists "scheduling_staff_reads_work_orders" on public.work_orders;
create policy "scheduling_staff_reads_work_orders"
  on public.work_orders
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "scheduling_staff_inserts_work_orders" on public.work_orders;
create policy "scheduling_staff_inserts_work_orders"
  on public.work_orders
  for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "scheduling_staff_updates_work_orders" on public.work_orders;
create policy "scheduling_staff_updates_work_orders"
  on public.work_orders
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- scheduled_visits: staff select / insert / update.

drop policy if exists "scheduling_staff_reads_scheduled_visits" on public.scheduled_visits;
create policy "scheduling_staff_reads_scheduled_visits"
  on public.scheduled_visits
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "scheduling_staff_inserts_scheduled_visits" on public.scheduled_visits;
create policy "scheduling_staff_inserts_scheduled_visits"
  on public.scheduled_visits
  for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "scheduling_staff_updates_scheduled_visits" on public.scheduled_visits;
create policy "scheduling_staff_updates_scheduled_visits"
  on public.scheduled_visits
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- crew_assignments: staff select / insert / update.

drop policy if exists "scheduling_staff_reads_crew_assignments" on public.crew_assignments;
create policy "scheduling_staff_reads_crew_assignments"
  on public.crew_assignments
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "scheduling_staff_inserts_crew_assignments" on public.crew_assignments;
create policy "scheduling_staff_inserts_crew_assignments"
  on public.crew_assignments
  for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "scheduling_staff_updates_crew_assignments" on public.crew_assignments;
create policy "scheduling_staff_updates_crew_assignments"
  on public.crew_assignments
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());
