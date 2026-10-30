-- Staff-only corporate identifiers, registrations, recurring filings, and documents.

create table if not exists public.corporate_profile (
  singleton boolean primary key default true check (singleton),
  legal_name text check (legal_name is null or char_length(legal_name) between 1 and 512),
  dba_names text[] not null default '{}',
  entity_type text check (
    entity_type is null
    or entity_type in (
      'llc',
      's_corp',
      'c_corp',
      'partnership',
      'sole_prop',
      'nonprofit',
      'other'
    )
  ),
  tax_classification text check (
    tax_classification is null or char_length(tax_classification) between 1 and 128
  ),
  ein text check (ein is null or ein ~ '^\d{2}-\d{7}$'),
  formation_state char(2) check (
    formation_state is null or formation_state ~ '^[A-Z]{2}$'
  ),
  formation_date date,
  sos_entity_number text check (
    sos_entity_number is null or char_length(sos_entity_number) between 1 and 128
  ),
  registered_agent_name text check (
    registered_agent_name is null or char_length(registered_agent_name) between 1 and 256
  ),
  registered_agent_address text check (
    registered_agent_address is null or char_length(registered_agent_address) between 1 and 1024
  ),
  principal_address text check (
    principal_address is null or char_length(principal_address) between 1 and 1024
  ),
  mailing_address text check (
    mailing_address is null or char_length(mailing_address) between 1 and 1024
  ),
  fiscal_year_end text check (
    fiscal_year_end is null or fiscal_year_end ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
  ),
  naics_code text check (naics_code is null or char_length(naics_code) between 1 and 32),
  duns_or_uei text check (duns_or_uei is null or char_length(duns_or_uei) between 1 and 64),
  notes text check (notes is null or char_length(notes) <= 8000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

comment on table public.corporate_profile is
  'Singleton corporate identity row per client database. Staff-only via RLS.';

create table if not exists public.corporate_registrations (
  id uuid primary key default gen_random_uuid(),
  jurisdiction text not null check (char_length(jurisdiction) between 1 and 64),
  kind text not null check (
    kind in (
      'sos_foreign_qualification',
      'sales_tax_permit',
      'withholding_account',
      'unemployment_suta',
      'franchise_tax',
      'local_business_license',
      'professional_license',
      'other'
    )
  ),
  label text not null check (char_length(label) between 1 and 256),
  identifier text check (identifier is null or char_length(identifier) between 1 and 256),
  agency_name text check (agency_name is null or char_length(agency_name) between 1 and 256),
  portal_url text check (portal_url is null or char_length(portal_url) between 1 and 2048),
  onepassword_ref text check (
    onepassword_ref is null
    or (
      onepassword_ref ~ '^op://'
      and char_length(onepassword_ref) between 8 and 512
    )
  ),
  effective_date date,
  status text not null default 'active' check (status in ('active', 'inactive', 'pending')),
  notes text check (notes is null or char_length(notes) <= 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists corporate_registrations_jurisdiction_idx
  on public.corporate_registrations (jurisdiction);

comment on table public.corporate_registrations is
  'State and local registration identifiers. Staff-only via RLS.';

create table if not exists public.corporate_filings (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid references public.corporate_registrations (id) on delete set null,
  jurisdiction text not null check (char_length(jurisdiction) between 1 and 64),
  name text not null check (char_length(name) between 1 and 256),
  frequency text not null check (
    frequency in ('annual', 'biennial', 'quarterly', 'monthly', 'one_time')
  ),
  next_due_date date,
  last_filed_date date,
  last_confirmation text check (
    last_confirmation is null or char_length(last_confirmation) between 1 and 512
  ),
  portal_url text check (portal_url is null or char_length(portal_url) between 1 and 2048),
  notes text check (notes is null or char_length(notes) <= 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists corporate_filings_next_due_date_idx
  on public.corporate_filings (next_due_date);

comment on table public.corporate_filings is
  'Recurring corporate filing obligations. Staff-only via RLS.';

create table if not exists public.corporate_documents (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique check (
    char_length(storage_path) between 1 and 1024
    and storage_path !~ '^/'
  ),
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (
    mime_type in (
      'application/pdf',
      'image/gif',
      'image/jpeg',
      'image/png',
      'image/webp'
    )
  ),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  doc_type text not null check (
    doc_type in (
      'ein_letter',
      'articles',
      'operating_agreement',
      'state_registration',
      'annual_report',
      'tax_certificate',
      'other'
    )
  ),
  registration_id uuid references public.corporate_registrations (id) on delete set null,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.corporate_documents is
  'Metadata for corporate source documents in the corporate-documents Storage bucket.';

-- Keep updated_at current on every mutation, including staff writes made
-- straight through the Data API (the column default only covers insert).
create or replace function public.corporate_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists corporate_profile_set_updated_at on public.corporate_profile;
create trigger corporate_profile_set_updated_at
  before update on public.corporate_profile
  for each row execute function public.corporate_set_updated_at();

drop trigger if exists corporate_registrations_set_updated_at on public.corporate_registrations;
create trigger corporate_registrations_set_updated_at
  before update on public.corporate_registrations
  for each row execute function public.corporate_set_updated_at();

drop trigger if exists corporate_filings_set_updated_at on public.corporate_filings;
create trigger corporate_filings_set_updated_at
  before update on public.corporate_filings
  for each row execute function public.corporate_set_updated_at();

-- Legacy projects carry default privileges that grant anon everything on new
-- tables (see 0062); strip them so anon has no Data API path at all.
revoke all on public.corporate_profile, public.corporate_registrations,
  public.corporate_filings, public.corporate_documents from anon;

-- Data API grants must precede RLS policies.
grant select, insert, update, delete on public.corporate_profile to authenticated;
grant select, insert, update, delete on public.corporate_registrations to authenticated;
grant select, insert, update, delete on public.corporate_filings to authenticated;
grant select, insert, update, delete on public.corporate_documents to authenticated;

alter table public.corporate_profile enable row level security;
alter table public.corporate_registrations enable row level security;
alter table public.corporate_filings enable row level security;
alter table public.corporate_documents enable row level security;

drop policy if exists "corporate_staff_all_profile" on public.corporate_profile;
create policy "corporate_staff_all_profile"
  on public.corporate_profile for all
  to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "corporate_staff_all_registrations" on public.corporate_registrations;
create policy "corporate_staff_all_registrations"
  on public.corporate_registrations for all
  to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "corporate_staff_all_filings" on public.corporate_filings;
create policy "corporate_staff_all_filings"
  on public.corporate_filings for all
  to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "corporate_staff_all_documents" on public.corporate_documents;
create policy "corporate_staff_all_documents"
  on public.corporate_documents for all
  to authenticated
  using (public.is_staff()) with check (public.is_staff());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'corporate-documents',
  'corporate-documents',
  false,
  10485760,
  array[
    'application/pdf',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "corporate_staff_selects_corporate_document_objects" on storage.objects;
create policy "corporate_staff_selects_corporate_document_objects"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'corporate-documents' and public.is_staff());

drop policy if exists "corporate_staff_inserts_corporate_document_objects" on storage.objects;
create policy "corporate_staff_inserts_corporate_document_objects"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'corporate-documents' and public.is_staff());

drop policy if exists "corporate_staff_updates_corporate_document_objects" on storage.objects;
create policy "corporate_staff_updates_corporate_document_objects"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'corporate-documents' and public.is_staff())
  with check (bucket_id = 'corporate-documents' and public.is_staff());

drop policy if exists "corporate_staff_deletes_corporate_document_objects" on storage.objects;
create policy "corporate_staff_deletes_corporate_document_objects"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'corporate-documents' and public.is_staff());
