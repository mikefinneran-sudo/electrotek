-- ElectroTek forensic-case domain.
--
-- public.cases remains owned by module-crm. Every case relationship below is
-- an FK to that aggregate; this migration does not alter public.cases.
-- legacy_id/source_system support the FileMaker truncate-and-reload import.

create extension if not exists pgcrypto;

create table if not exists public.case_evidence (
  id                   uuid primary key default gen_random_uuid(),
  case_id              uuid null references public.cases(id) on delete set null,
  -- Evidence spans the current and archive registers and has one true orphan.
  -- Preserve the source string even when no parent UUID can be resolved.
  legacy_case_ref      text null,
  description          text null,
  piece_count          text null,
  received_on          date null,
  report_on            date null,
  action               text null,
  action_on            date null,
  disposition_on       date null,
  disposition_method   text null,
  custodian_initials   text null,
  storage_location     text null,
  other_location       text null,
  response             text null,
  results              text null,
  returned_to          text null,
  xray_status          text null,
  xray_on              date null,
  work_order_reference text null,
  legacy_id            text null,
  source_system        text null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz null
);

create index if not exists case_evidence_case_idx
  on public.case_evidence (case_id, created_at desc);
create index if not exists case_evidence_legacy_idx
  on public.case_evidence (source_system, legacy_id);

create table if not exists public.case_claimants (
  id                uuid primary key default gen_random_uuid(),
  case_id           uuid not null references public.cases(id) on delete restrict,
  legacy_case_ref   text null,
  display_name      text null,
  first_name        text null,
  last_name         text null,
  status            text null,
  address_line_1    text null,
  address_line_2    text null,
  city              text null,
  state             text null,
  postal_code       text null,
  loss_date         date null,
  email             text null,
  cell_phone        text null,
  home_phone        text null,
  work_phone        text null,
  work_extension    text null,
  instructions      text null,
  legacy_id         text null,
  source_system     text null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz null
);

create index if not exists case_claimants_case_idx
  on public.case_claimants (case_id, created_at desc);
create index if not exists case_claimants_legacy_idx
  on public.case_claimants (source_system, legacy_id);

-- A source address may be shared by an organization and one or more people.
-- Nullable, independent FKs preserve that overlap and also admit sites/cases.
create table if not exists public.addresses (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid null references public.accounts(id) on delete set null,
  contact_id           uuid null references public.contacts(id) on delete set null,
  case_id              uuid null references public.cases(id) on delete set null,
  legacy_account_ref   text null,
  legacy_contact_ref   text null,
  legacy_expert_ref    text null,
  category             text null,
  line_1               text null,
  formatted_address    text null,
  city                 text null,
  state                text null,
  postal_code          text null,
  legacy_id            text null,
  source_system        text null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz null
);

create index if not exists addresses_account_idx
  on public.addresses (account_id, created_at desc);
create index if not exists addresses_contact_idx
  on public.addresses (contact_id, created_at desc);
create index if not exists addresses_case_idx
  on public.addresses (case_id, created_at desc);
create index if not exists addresses_legacy_idx
  on public.addresses (source_system, legacy_id);

-- Contact_#s and EMails are the same many-per-person child shape. Some source
-- rows belong to organizations, so both parent kinds are represented.
create table if not exists public.contact_methods (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null,
  contact_id           uuid null references public.contacts(id) on delete set null,
  account_id           uuid null references public.accounts(id) on delete set null,
  legacy_contact_ref   text null,
  legacy_account_ref   text null,
  label                text null,
  value                text null,
  extension            text null,
  is_primary           boolean not null default false,
  legacy_id            text null,
  source_system        text null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz null,
  constraint contact_methods_kind_valid check (kind in ('phone', 'email'))
);

create index if not exists contact_methods_contact_idx
  on public.contact_methods (contact_id, kind, created_at desc);
create index if not exists contact_methods_account_idx
  on public.contact_methods (account_id, kind, created_at desc);
create index if not exists contact_methods_legacy_idx
  on public.contact_methods (source_system, legacy_id);

-- The three FileMaker case-party joins share one normalized shape. Nullable
-- parents are intentional: source measurement found case and party orphans.
create table if not exists public.case_participants (
  id                   uuid primary key default gen_random_uuid(),
  participant_type     text not null,
  case_id              uuid null references public.cases(id) on delete set null,
  contact_id           uuid null references public.contacts(id) on delete set null,
  account_id           uuid null references public.accounts(id) on delete set null,
  legacy_case_ref      text null,
  legacy_contact_ref   text null,
  legacy_account_ref   text null,
  role                 text null,
  notes                text null,
  legacy_id            text null,
  source_system        text null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz null,
  constraint case_participants_type_valid
    check (participant_type in ('expert', 'attorney', 'contact'))
);

create index if not exists case_participants_case_idx
  on public.case_participants (case_id, participant_type, created_at desc);
create index if not exists case_participants_contact_idx
  on public.case_participants (contact_id, created_at desc);
create index if not exists case_participants_account_idx
  on public.case_participants (account_id, created_at desc);
create index if not exists case_participants_legacy_idx
  on public.case_participants (source_system, legacy_id);

create table if not exists public.depositions (
  id                uuid primary key default gen_random_uuid(),
  -- One of the nine source rows has no case.
  case_id           uuid null references public.cases(id) on delete set null,
  legacy_case_ref   text null,
  deponent          text null,
  scheduled_on      date null,
  description       text null,
  display_text      text null,
  location          text null,
  legacy_id         text null,
  source_system     text null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz null
);

create index if not exists depositions_case_idx
  on public.depositions (case_id, scheduled_on desc);
create index if not exists depositions_legacy_idx
  on public.depositions (source_system, legacy_id);

-- The hours half of FileMaker Expenses. Reimbursable costs continue to use
-- public.expenses with subject_type = 'case'; they are not duplicated here.
create table if not exists public.case_time_entries (
  id                 uuid primary key default gen_random_uuid(),
  case_id            uuid not null references public.cases(id) on delete restrict,
  -- public.staff requires an auth.users identity. Legacy billing identities
  -- therefore resolve through legacy_staff_ref until a real login is linked.
  staff_id           uuid null references public.staff(id) on delete set null,
  legacy_case_ref    text null,
  legacy_staff_ref   text null,
  entry_date         date null,
  category           text null,
  description        text null,
  -- Scale set by the source, not by habit. FileMaker records hours like 2.666
  -- and multipliers like .333333; numeric(8,2) rounded both on the way in, and
  -- a billing record that disagrees with the source by a rounding step is the
  -- silent kind of wrong.
  hours              numeric(10,4) not null,
  hourly_rate        numeric(12,2) null,
  multiplier         numeric(16,6) null,
  invoice_number     text null,
  location           text null,
  billed_amount      numeric(12,2) null,
  legacy_id          text null,
  source_system      text null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz null,
  constraint case_time_entries_staff_reference_present
    check (staff_id is not null or legacy_staff_ref is not null),
  constraint case_time_entries_hours_non_negative check (hours >= 0),
  constraint case_time_entries_rate_non_negative
    check (hourly_rate is null or hourly_rate >= 0),
  constraint case_time_entries_multiplier_non_negative
    check (multiplier is null or multiplier >= 0)
);

create index if not exists case_time_entries_case_idx
  on public.case_time_entries (case_id, entry_date desc, created_at desc);
create index if not exists case_time_entries_staff_idx
  on public.case_time_entries (staff_id, entry_date desc);
create index if not exists case_time_entries_invoice_idx
  on public.case_time_entries (invoice_number)
  where invoice_number is not null;
create index if not exists case_time_entries_legacy_idx
  on public.case_time_entries (source_system, legacy_id);

-- Keep updated_at correct for direct Data API writes as well as server writes.
create or replace function public.forensic_case_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists forensic_case_evidence_set_updated_at on public.case_evidence;
create trigger forensic_case_evidence_set_updated_at
  before update on public.case_evidence
  for each row execute function public.forensic_case_set_updated_at();

drop trigger if exists forensic_case_claimants_set_updated_at on public.case_claimants;
create trigger forensic_case_claimants_set_updated_at
  before update on public.case_claimants
  for each row execute function public.forensic_case_set_updated_at();

drop trigger if exists forensic_case_addresses_set_updated_at on public.addresses;
create trigger forensic_case_addresses_set_updated_at
  before update on public.addresses
  for each row execute function public.forensic_case_set_updated_at();

drop trigger if exists forensic_case_contact_methods_set_updated_at on public.contact_methods;
create trigger forensic_case_contact_methods_set_updated_at
  before update on public.contact_methods
  for each row execute function public.forensic_case_set_updated_at();

drop trigger if exists forensic_case_participants_set_updated_at on public.case_participants;
create trigger forensic_case_participants_set_updated_at
  before update on public.case_participants
  for each row execute function public.forensic_case_set_updated_at();

drop trigger if exists forensic_case_depositions_set_updated_at on public.depositions;
create trigger forensic_case_depositions_set_updated_at
  before update on public.depositions
  for each row execute function public.forensic_case_set_updated_at();

drop trigger if exists forensic_case_time_entries_set_updated_at on public.case_time_entries;
create trigger forensic_case_time_entries_set_updated_at
  before update on public.case_time_entries
  for each row execute function public.forensic_case_set_updated_at();

-- Data API grants (WAL-603). Grants must precede RLS policy creation because a
-- new Supabase project grants authenticated no table privileges by default.
grant select, insert, update, delete on public.case_evidence to authenticated;
grant select, insert, update, delete on public.case_claimants to authenticated;
grant select, insert, update, delete on public.addresses to authenticated;
grant select, insert, update, delete on public.contact_methods to authenticated;
grant select, insert, update, delete on public.case_participants to authenticated;
grant select, insert, update, delete on public.depositions to authenticated;
grant select, insert, update, delete on public.case_time_entries to authenticated;

-- RLS remains the catalog-wide gate even when a client does not enable this
-- module, because public is exposed through the Supabase Data API.
alter table public.case_evidence enable row level security;
alter table public.case_claimants enable row level security;
alter table public.addresses enable row level security;
alter table public.contact_methods enable row level security;
alter table public.case_participants enable row level security;
alter table public.depositions enable row level security;
alter table public.case_time_entries enable row level security;

drop policy if exists "forensic_case_staff_all_case_evidence" on public.case_evidence;
create policy "forensic_case_staff_all_case_evidence"
  on public.case_evidence for all
  to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "forensic_case_staff_all_case_claimants" on public.case_claimants;
create policy "forensic_case_staff_all_case_claimants"
  on public.case_claimants for all
  to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "forensic_case_staff_all_addresses" on public.addresses;
create policy "forensic_case_staff_all_addresses"
  on public.addresses for all
  to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "forensic_case_staff_all_contact_methods" on public.contact_methods;
create policy "forensic_case_staff_all_contact_methods"
  on public.contact_methods for all
  to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "forensic_case_staff_all_case_participants" on public.case_participants;
create policy "forensic_case_staff_all_case_participants"
  on public.case_participants for all
  to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "forensic_case_staff_all_depositions" on public.depositions;
create policy "forensic_case_staff_all_depositions"
  on public.depositions for all
  to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "forensic_case_staff_all_case_time_entries" on public.case_time_entries;
create policy "forensic_case_staff_all_case_time_entries"
  on public.case_time_entries for all
  to authenticated
  using (public.is_staff()) with check (public.is_staff());

comment on table public.case_evidence is
  'Physical forensic evidence and exhibits. Serves FileMaker Evidence and may retain an unresolved legacy case reference.';
comment on table public.case_claimants is
  'Claimant records attached to cases. Serves FileMaker Join_Case_Claimants.';
comment on table public.addresses is
  'Many-per-entity postal/site addresses for accounts, contacts, and cases.';
comment on table public.contact_methods is
  'Many-per-entity phone and email rows. Serves FileMaker Contact_#s and EMails.';
comment on table public.case_participants is
  'Expert, attorney, and general-contact joins for a case.';
comment on table public.depositions is
  'Forensic-case deposition records.';
comment on table public.case_time_entries is
  'Billable hours from the time half of FileMaker Expenses; reimbursable costs remain in public.expenses.';
