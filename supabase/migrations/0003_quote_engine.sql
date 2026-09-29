-- Quote engine module schema. Foundation of the service-provider vertical:
-- owns inspections (the central walkthrough record), quote_addons, and the
-- task_library. The contract-esign, visit-checkflow, crew-portal, and
-- client-portal modules build on these tables (Wave 2). This migration is
-- self-contained — it owns no catalog/ordering/lead-capture tables and does not
-- depend on them.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'inspection_status'
      and n.nspname = 'public'
  ) then
    create type public.inspection_status as enum (
      'drafting',
      'ready_to_send',
      'sent',
      'accepted',
      'declined'
    );
  end if;
end
$$;

create table if not exists public.inspections (
  id uuid primary key default gen_random_uuid(),
  inspection_slug text not null unique,
  prospect_name text,
  prospect_company text,
  prospect_email text,
  prospect_phone text,
  office_address text,
  walkthrough_date date,
  cleanable_sqft numeric,
  visits_per_week numeric,
  scope_inclusions text,
  scope_exclusions text,
  cleaning_days text,
  clean_window text,
  target_start text,
  consumables_provided_by text,
  current_cleaner text,
  current_cleaner_issues text,
  decision_process text,
  internal_notes text,
  number_of_offices integer,
  number_of_board_rooms integer,
  dumpster_access text,
  parking_access text,
  water_access text,
  status public.inspection_status not null default 'drafting',
  sent_at timestamptz,
  quote_rate_per_sqft numeric(10,4),
  quote_base_monthly numeric(10,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Contract/signature columns are intentionally absent — they belong to the
-- contract-esign module (Wave 2), which will reference inspections.id.

create table if not exists public.quote_addons (
  id serial primary key,
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  addon_id text not null,
  name text not null,
  price numeric(10,2) not null default 0,
  enabled boolean not null default true,
  unique (inspection_id, addon_id)
);

create table if not exists public.task_library (
  id serial primary key,
  task_name text not null,
  default_frequency text,
  area text,
  match_keywords text,
  sort_order numeric not null default 0,
  always_include boolean not null default false,
  active boolean not null default true
);

create index if not exists inspections_status_idx on public.inspections (status);
create index if not exists inspections_created_at_idx on public.inspections (created_at);
create index if not exists quote_addons_inspection_id_idx on public.quote_addons (inspection_id);
create index if not exists task_library_sort_order_idx on public.task_library (sort_order);

-- Keep inspections.updated_at current on every mutation (the column default only
-- covers insert). Module-scoped name so it can't clash with another module's
-- updated_at trigger.
create or replace function public.quote_engine_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists quote_engine_inspections_set_updated_at on public.inspections;
create trigger quote_engine_inspections_set_updated_at
  before update on public.inspections
  for each row execute function public.quote_engine_set_updated_at();

comment on table public.inspections is
  'Owned by @waltersignal/bananaforce-module-quote-engine. The central walkthrough/quote record. Staff/service-role managed: no anon or authenticated access until the admin/crew modules add staff-scoped RLS policies. Reads/writes go through the service-role client in server.ts.';
comment on table public.quote_addons is
  'Owned by @waltersignal/bananaforce-module-quote-engine. Per-inspection optional add-on line items. Replaces ABC''s Quote Add-ons JSON blob. Staff/service-role managed (same posture as inspections).';
comment on table public.task_library is
  'Owned by @waltersignal/bananaforce-module-quote-engine. Reusable scope-task catalog used to suggest site-specific tasks from walkthrough scope text. Readable by authenticated users; writes are service-role only.';

-- Seed the reusable task library (ported from always-be-cleaning task-library.csv).
-- is_active idiom mirrors catalog: rows are filtered by active in server reads.
insert into public.task_library
  (task_name, default_frequency, area, match_keywords, sort_order, always_include, active)
values
  ('Empty trash and replace liners', 'Daily', 'General', 'trash|garbage|bins|waste|recycling', 10, false, true),
  ('Clean and sanitize restrooms', 'Daily', 'Restrooms', 'restroom|bathroom|toilet|restrooms', 20, false, true),
  ('Refill restroom supplies', 'Per Visit', 'Restrooms', 'restroom supplies|paper towels|soap|toilet paper|refill', 30, false, true),
  ('Vacuum carpets and rugs', '3×/week', 'General', 'vacuum|carpet|rugs', 40, false, true),
  ('Dust surfaces and furniture', 'Weekly', 'General', 'dust|dusting|surfaces|furniture|blinds', 50, false, true),
  ('Wipe high-touch surfaces', 'Daily', 'General', 'high-touch|high touch|door handles|light switches|disinfect|sanitize', 60, false, true),
  ('Clean break room / kitchen', 'Per Visit', 'Kitchen', 'kitchen|break room|breakroom|microwave|fridge|refrigerator', 70, false, true),
  ('Mop hard floors', '2×/week', 'General', 'mop|hard floor|tile|vinyl|floors', 80, false, true),
  ('Clean interior glass and mirrors', 'Weekly', 'General', 'glass|mirrors|windows|interior glass', 90, false, true),
  ('Empty dishwasher / clean sink area', 'Per Visit', 'Kitchen', 'dishwasher|dishes|sink', 100, false, true),
  ('Restock paper products and consumables', 'As Needed', 'General', 'paper products|consumables|kleenex|tissues|restock', 110, false, true),
  ('Secure building on exit — lock confirmed', 'Per Visit', 'Security', 'lock|secure|building secured|exit|locked', 900, true, true)
on conflict do nothing;

alter table public.inspections enable row level security;
alter table public.quote_addons enable row level security;
alter table public.task_library enable row level security;

revoke all on public.inspections from anon, authenticated;
revoke all on public.quote_addons from anon, authenticated;
revoke all on public.task_library from anon, authenticated;

-- inspections + quote_addons are staff/service-role managed. No grants and no
-- policies for anon/authenticated: with RLS enabled, every operation is denied
-- by default. The service-role key bypasses RLS, so server.ts reads and writes
-- these tables. Staff-scoped read/write policies arrive with the admin/crew
-- modules (Wave 2), keyed off a staff-auth check.

-- task_library is internal operational reference data (scope-task templates),
-- NOT public reference. It is read via the service-role client in server.ts. We
-- deliberately do NOT grant select to `authenticated`: in a shared Supabase
-- project the catalog module's retail customers are `authenticated` too, and
-- they have no business reading crew task templates. A staff-scoped read policy
-- arrives with the admin/crew module (Wave 2/3), keyed off a staff-auth check.

-- No anon or authenticated policies are defined on any quote-engine table.
-- Staff read/write policies for inspections, quote_addons, and task_library are
-- deferred to the admin/crew modules.
