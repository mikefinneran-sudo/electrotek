-- CRM module schema. Owns: accounts, contacts, crm_pipeline_stages,
-- crm_opportunities, crm_activities, crm_tasks.
--
-- Staff/service-role managed throughout: RLS enabled, anon/authenticated revoked,
-- additive crm_staff_* policies keyed off public.is_staff() (defined in the admin
-- module's 0001_admin.sql — do NOT recreate the staff table or is_staff() here).
-- At runtime all reads and writes go through the service-role client in server.ts.
-- The staff RLS policies are the forward path for a session-scoped client.
--
-- Self-contained: does not alter tables owned by other modules, and does NOT add
-- a FK from contacts.lead_id to public.leads (lead ownership is another module).

create extension if not exists pgcrypto;

-- accounts: company/organization records ----------------------------------------
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text,
  industry text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- contacts: people, optionally linked to accounts and/or leads ------------------
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete set null,
  -- Optional cross-reference to public.leads (owned by the lead-capture module).
  -- Kept as a plain uuid to avoid a cross-module FK constraint.
  lead_id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- crm_pipeline_stages: the ordered stages a deal moves through -----------------
create table if not exists public.crm_pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order numeric not null default 0,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  active boolean not null default true,
  -- A stage is won, lost, or neither — never both at once.
  constraint crm_pipeline_stages_won_xor_lost check (not (is_won and is_lost))
);

-- Default pipeline: stable names, stable UUIDs for idempotent seed.
insert into public.crm_pipeline_stages (id, name, sort_order, is_won, is_lost, active)
values
  ('11111111-0001-0001-0001-000000000001', 'Lead',        0,  false, false, true),
  ('11111111-0001-0001-0001-000000000002', 'Qualified',   1,  false, false, true),
  ('11111111-0001-0001-0001-000000000003', 'Proposal',    2,  false, false, true),
  ('11111111-0001-0001-0001-000000000004', 'Negotiation', 3,  false, false, true),
  ('11111111-0001-0001-0001-000000000005', 'Won',         10, true,  false, true),
  ('11111111-0001-0001-0001-000000000006', 'Lost',        11, false, true,  true)
on conflict do nothing;

-- crm_opportunities: a deal in the pipeline ------------------------------------
create table if not exists public.crm_opportunities (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  stage_id uuid references public.crm_pipeline_stages(id) on delete set null,
  name text not null,
  amount numeric(12,2),
  close_date date,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- crm_activities: log of calls, emails, meetings, notes -----------------------
create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references public.crm_opportunities(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  account_id uuid references public.accounts(id) on delete set null,
  type text not null,
  body text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- crm_tasks: action items linked to opportunities and/or contacts --------------
create table if not exists public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references public.crm_opportunities(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  title text not null,
  due_date date,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes on all FK columns and frequently filtered columns --------------------
create index if not exists contacts_account_id_idx on public.contacts (account_id);
create index if not exists crm_opportunities_account_id_idx on public.crm_opportunities (account_id);
create index if not exists crm_opportunities_contact_id_idx on public.crm_opportunities (contact_id);
create index if not exists crm_opportunities_stage_id_idx on public.crm_opportunities (stage_id);
create index if not exists crm_opportunities_status_idx on public.crm_opportunities (status);
create index if not exists crm_activities_opportunity_id_idx on public.crm_activities (opportunity_id);
create index if not exists crm_activities_contact_id_idx on public.crm_activities (contact_id);
create index if not exists crm_tasks_opportunity_id_idx on public.crm_tasks (opportunity_id);
create index if not exists crm_tasks_contact_id_idx on public.crm_tasks (contact_id);

-- Module-scoped updated_at trigger function (name can't clash with other modules)
create or replace function public.crm_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists crm_accounts_set_updated_at on public.accounts;
create trigger crm_accounts_set_updated_at
  before update on public.accounts
  for each row execute function public.crm_set_updated_at();

drop trigger if exists crm_contacts_set_updated_at on public.contacts;
create trigger crm_contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.crm_set_updated_at();

drop trigger if exists crm_opportunities_set_updated_at on public.crm_opportunities;
create trigger crm_opportunities_set_updated_at
  before update on public.crm_opportunities
  for each row execute function public.crm_set_updated_at();

drop trigger if exists crm_tasks_set_updated_at on public.crm_tasks;
create trigger crm_tasks_set_updated_at
  before update on public.crm_tasks
  for each row execute function public.crm_set_updated_at();

-- Table comments ---------------------------------------------------------------
comment on table public.accounts is
  'Owned by @waltersignal/bananaforce-module-crm. Company/organization records. Staff/service-role managed: no anon or authenticated access. Reads/writes go through the service-role client in server.ts.';
comment on table public.contacts is
  'Owned by @waltersignal/bananaforce-module-crm. Contact persons, optionally linked to accounts. lead_id is a plain uuid cross-reference to the lead-capture module (no FK constraint). Staff/service-role managed.';
comment on table public.crm_pipeline_stages is
  'Owned by @waltersignal/bananaforce-module-crm. Ordered pipeline stages. Seeded with a default Lead→Won/Lost funnel. Staff/service-role managed.';
comment on table public.crm_opportunities is
  'Owned by @waltersignal/bananaforce-module-crm. Sales opportunities in the pipeline. Staff/service-role managed.';
comment on table public.crm_activities is
  'Owned by @waltersignal/bananaforce-module-crm. Activity log (call|email|meeting|note) per opportunity/contact. Staff/service-role managed.';
comment on table public.crm_tasks is
  'Owned by @waltersignal/bananaforce-module-crm. Action items linked to opportunities and/or contacts. Staff/service-role managed.';

-- RLS + revoke -----------------------------------------------------------------
alter table public.accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.crm_pipeline_stages enable row level security;
alter table public.crm_opportunities enable row level security;
alter table public.crm_activities enable row level security;
alter table public.crm_tasks enable row level security;

revoke all on public.accounts from anon, authenticated;
revoke all on public.contacts from anon, authenticated;
revoke all on public.crm_pipeline_stages from anon, authenticated;
revoke all on public.crm_opportunities from anon, authenticated;
revoke all on public.crm_activities from anon, authenticated;
revoke all on public.crm_tasks from anon, authenticated;

-- Additive staff RLS policies (forward path, keyed off public.is_staff()).
-- public.is_staff() is owned by the admin module (0001_admin.sql) — do NOT
-- recreate it here. These are the is_staff()-gated policies that become the
-- enforcement boundary once staff sign in with their own Supabase Auth session.
-- Named crm_staff_* so they do not clash with policies from other modules.

-- accounts
drop policy if exists crm_staff_accounts_select on public.accounts;
create policy crm_staff_accounts_select on public.accounts
  for select to authenticated
  using (public.is_staff());

drop policy if exists crm_staff_accounts_insert on public.accounts;
create policy crm_staff_accounts_insert on public.accounts
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists crm_staff_accounts_update on public.accounts;
create policy crm_staff_accounts_update on public.accounts
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- contacts
drop policy if exists crm_staff_contacts_select on public.contacts;
create policy crm_staff_contacts_select on public.contacts
  for select to authenticated
  using (public.is_staff());

drop policy if exists crm_staff_contacts_insert on public.contacts;
create policy crm_staff_contacts_insert on public.contacts
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists crm_staff_contacts_update on public.contacts;
create policy crm_staff_contacts_update on public.contacts
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- crm_pipeline_stages
drop policy if exists crm_staff_stages_select on public.crm_pipeline_stages;
create policy crm_staff_stages_select on public.crm_pipeline_stages
  for select to authenticated
  using (public.is_staff());

drop policy if exists crm_staff_stages_insert on public.crm_pipeline_stages;
create policy crm_staff_stages_insert on public.crm_pipeline_stages
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists crm_staff_stages_update on public.crm_pipeline_stages;
create policy crm_staff_stages_update on public.crm_pipeline_stages
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- crm_opportunities
drop policy if exists crm_staff_opportunities_select on public.crm_opportunities;
create policy crm_staff_opportunities_select on public.crm_opportunities
  for select to authenticated
  using (public.is_staff());

drop policy if exists crm_staff_opportunities_insert on public.crm_opportunities;
create policy crm_staff_opportunities_insert on public.crm_opportunities
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists crm_staff_opportunities_update on public.crm_opportunities;
create policy crm_staff_opportunities_update on public.crm_opportunities
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- crm_activities
drop policy if exists crm_staff_activities_select on public.crm_activities;
create policy crm_staff_activities_select on public.crm_activities
  for select to authenticated
  using (public.is_staff());

drop policy if exists crm_staff_activities_insert on public.crm_activities;
create policy crm_staff_activities_insert on public.crm_activities
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists crm_staff_activities_update on public.crm_activities;
create policy crm_staff_activities_update on public.crm_activities
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- crm_tasks
drop policy if exists crm_staff_tasks_select on public.crm_tasks;
create policy crm_staff_tasks_select on public.crm_tasks
  for select to authenticated
  using (public.is_staff());

drop policy if exists crm_staff_tasks_insert on public.crm_tasks;
create policy crm_staff_tasks_insert on public.crm_tasks
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists crm_staff_tasks_update on public.crm_tasks;
create policy crm_staff_tasks_update on public.crm_tasks
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());
