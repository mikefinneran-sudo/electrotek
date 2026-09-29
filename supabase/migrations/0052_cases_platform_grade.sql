-- Bring public.cases up to the shape 0043_crm_platform_grade gave the rest of
-- the CRM. 0007 created the table without these, which left it inconsistent
-- with its own module: every list read in server.ts filters `deleted_at is
-- null`, and a table with no such column cannot participate in that pattern —
-- a case could only ever be hard-deleted, unlike accounts, contacts and
-- opportunities.
--
-- Case files are the worst possible candidate for a hard delete. A forensic
-- engagement is evidence: it carries chain-of-custody notes, expenses billed
-- back to a carrier, and testimony that may be challenged years later. Deleting
-- the row would orphan every expense attributed to it, since expenses.subject_id
-- is polymorphic and has no foreign key to enforce anything.

alter table public.cases
  add column if not exists deleted_at timestamptz;

alter table public.cases
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

comment on column public.cases.deleted_at is
  'Soft-delete timestamp. Active CRM reads filter deleted_at is null in server.ts, not in RLS.';

-- Matches accounts_active_keyset_idx: the list view pages by (created_at, id)
-- over active rows only.
create index if not exists cases_active_keyset_idx
  on public.cases (created_at desc, id desc)
  where deleted_at is null;

create index if not exists cases_custom_fields_gin_idx
  on public.cases using gin (custom_fields);

-- case_number stays unique across ALL rows including soft-deleted ones. That is
-- deliberate and differs from a typical soft-delete convention: a case number is
-- the firm's external reference, printed on invoices and reports and cited in
-- depositions. Reissuing a retired number to a different investigation would
-- make two distinct matters indistinguishable in the record.
