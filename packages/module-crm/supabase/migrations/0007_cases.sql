-- Cases: the operational entity a forensic engagement is organised around.
--
-- Until now the CRM offered accounts, contacts and crm_opportunities, and an
-- opportunity is a sales-pipeline record with won/lost stages. That does not
-- describe an investigation, which is opened, worked, and closed, and which
-- accrues reimbursable cost the whole time. 0047_expense.sql already recorded
-- this absence in a comment on expenses.subject_type: "the target entity
-- (case/matter) is an open decision." This migration closes that decision.
--
-- A case belongs to an account (the carrier or law firm that retained the
-- firm), not to a contact: the retaining party is an organisation and the
-- individual adjuster or attorney changes over the life of a matter. contact_id
-- records the current day-to-day contact and is deliberately nullable.
--
-- legacy_id / source_system are carried per the ElectroTek deploy design: the
-- FileMaker conversion lands here later, and those columns are what make the
-- import idempotent (full truncate-and-reload, never incremental).

create extension if not exists pgcrypto;

create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  -- The firm's own file number. Unique because it is the human key staff use
  -- on invoices, reports and expense receipts.
  case_number      text not null unique,
  account_id       uuid references public.accounts(id) on delete set null,
  contact_id       uuid references public.contacts(id) on delete set null,
  title            text not null,
  status           text not null default 'open',
  -- Free text rather than an enum: the firm's investigation categories are a
  -- business taxonomy that changes without a schema migration.
  case_type        text,
  incident_date    date,
  incident_location text,
  opened_on        date not null default current_date,
  closed_on        date,
  notes            text,
  legacy_id        text,
  source_system    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint cases_status_valid
    check (status in ('open', 'on_hold', 'closed')),
  -- A closed case carries a closing date and an open one does not, so the two
  -- representations of "is this finished" cannot disagree.
  constraint cases_closed_on_matches_status
    check ((status = 'closed') = (closed_on is not null)),
  constraint cases_closed_not_before_opened
    check (closed_on is null or closed_on >= opened_on)
);

create index if not exists cases_account_id_idx on public.cases (account_id);
create index if not exists cases_status_idx     on public.cases (status);
-- Supports the FileMaker re-import, which matches on the source key.
create index if not exists cases_legacy_idx     on public.cases (source_system, legacy_id);

-- Data API grants. Per WAL-581 (0046_data_api_grants.sql) a project created
-- after 2026-05-30 grants the API roles nothing on a table a migration creates.
-- The grant layer is checked before RLS, so without this the staff policy below
-- is dead code and every call fails with permission denied. This is the exact
-- defect WAL-603 fixed for the expense module; do not omit it here.
grant select, insert, update, delete on public.cases to authenticated;

-- RLS. Per WAL-586 this must hold catalog-wide in every deploy: config.toml
-- exposes `public` over the Data API, so RLS is the only gate on these tables
-- whether or not a given client enabled this module.
alter table public.cases enable row level security;

drop policy if exists "crm_staff_all_cases" on public.cases;
create policy "crm_staff_all_cases"
  on public.cases for all
  to authenticated
  using (public.is_staff()) with check (public.is_staff());

comment on table public.cases is
  'Owned by @waltersignal/bananaforce-module-crm. One row per forensic engagement. Expenses attribute to a case via expenses.subject_type = ''case''.';
