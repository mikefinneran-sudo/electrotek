-- Reporting module schema. Owns ONE table (report_saved_views) for staff-saved
-- dashboard view configs. All runtime access is through the service-role client
-- (RLS bypassed). The staff RLS policies below are the forward path for when a
-- staff session (not service-role) is used.
--
-- This module READS from other modules' tables (invoices, crm_opportunities,
-- crm_pipeline_stages, work_orders, tickets, assets, asset_assignments) via
-- server.ts with the service-role client. It does NOT own, create, or alter
-- any of those tables.
--
-- Apply module-admin before this migration (is_staff() must exist).

create extension if not exists pgcrypto;

-- report_saved_views: named dashboard snapshots saved by staff. The config
-- column holds arbitrary JSON (date range, filters, column order) so views can
-- be reconstructed without re-deriving the UI state.
create table if not exists public.report_saved_views (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null
    check (kind in ('kpi', 'pipeline', 'jobs', 'tickets', 'assets')),
  config      jsonb not null default '{}'::jsonb,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Bound the opaque config blob at the DB layer so the cap holds for every
  -- caller, not just the route picker (8 KB is ample for view state).
  constraint report_saved_views_config_size check (octet_length(config::text) <= 8192)
);

comment on table public.report_saved_views is
  'Owned by @waltersignal/bananaforce-module-reporting. Staff-saved KPI/dashboard view configs. Service-role managed: no anon or authenticated write path until reporting_staff_* policies are activated.';

-- Trigger function: module-scoped name avoids clashing with other modules.
create or replace function public.reporting_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists reporting_saved_views_updated_at on public.report_saved_views;
create trigger reporting_saved_views_updated_at
  before update on public.report_saved_views
  for each row execute function public.reporting_set_updated_at();

-- Index on kind for filtered list queries (e.g. ?kind=kpi).
create index if not exists report_saved_views_kind_idx on public.report_saved_views(kind);

-- RLS: enabled; all direct authenticated/anon access denied by default.
-- Runtime path: service-role client bypasses RLS entirely.
alter table public.report_saved_views enable row level security;
revoke all on public.report_saved_views from anon, authenticated;

-- ===========================================================================
-- Staff-scoped RLS policies (FORWARD PATH — dormant at MVP runtime).
--
-- At MVP, server.ts uses the service-role client behind the route authorize
-- gate. These policies become active when the app switches to a staff session
-- (not service-role). Additive naming avoids colliding with other modules.
-- ===========================================================================

drop policy if exists "reporting_staff_select" on public.report_saved_views;
create policy "reporting_staff_select"
  on public.report_saved_views
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "reporting_staff_insert" on public.report_saved_views;
create policy "reporting_staff_insert"
  on public.report_saved_views
  for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "reporting_staff_update" on public.report_saved_views;
create policy "reporting_staff_update"
  on public.report_saved_views
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- DELETE policy is defined here (unlike deny-by-default modules) because the
-- module DOES expose a delete operation (deleteSavedView / DELETE route). The
-- forward staff-session path must be able to delete saved views.
drop policy if exists "reporting_staff_delete" on public.report_saved_views;
create policy "reporting_staff_delete"
  on public.report_saved_views
  for delete
  to authenticated
  using (public.is_staff());
