-- Licensing register: staff, company, and asset licenses with renewal history.
-- Every table carries legacy_id/source_system for the deferred FileMaker import.
-- A 'company' license is held by the firm itself: the corporate_profile
-- singleton (0082), so it carries no holder id. Removing a staff member or
-- asset keeps their licenses as history with a null holder id ("Removed").

create table if not exists public.licenses (
  id                  uuid primary key default gen_random_uuid(),
  holder_type         text not null,
  staff_holder_id     uuid null references public.staff(id) on delete set null,
  asset_holder_id     uuid null references public.assets(id) on delete set null,
  license_name        text not null,
  issuing_authority   text not null,
  jurisdiction        text null,
  license_number      text null,
  issued_date         date null,
  expiry_date         date null,
  renewal_window_days integer not null default 60,
  ceu_hours_required  numeric(7,2) null,
  notes               text null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  legacy_id           text null,
  source_system       text null,
  constraint licenses_holder_type_valid
    check (holder_type in ('staff', 'company', 'asset')),
  constraint licenses_one_matching_holder check (
    (
      holder_type = 'staff'
      and asset_holder_id is null
    ) or (
      holder_type = 'company'
      and staff_holder_id is null
      and asset_holder_id is null
    ) or (
      holder_type = 'asset'
      and staff_holder_id is null
    )
  ),
  constraint licenses_renewal_window_non_negative
    check (renewal_window_days >= 0),
  constraint licenses_ceu_hours_non_negative
    check (ceu_hours_required is null or ceu_hours_required >= 0),
  constraint licenses_ceu_hours_staff_only
    check (ceu_hours_required is null or holder_type = 'staff'),
  constraint licenses_dates_ordered
    check (issued_date is null or expiry_date is null or issued_date <= expiry_date)
);

create index if not exists licenses_expiry_date_idx
  on public.licenses (expiry_date)
  where expiry_date is not null;
create index if not exists licenses_holder_type_idx
  on public.licenses (holder_type);
create index if not exists licenses_staff_holder_idx
  on public.licenses (staff_holder_id)
  where staff_holder_id is not null;
create index if not exists licenses_asset_holder_idx
  on public.licenses (asset_holder_id)
  where asset_holder_id is not null;
create index if not exists licenses_license_number_idx
  on public.licenses (lower(issuing_authority), coalesce(jurisdiction, ''), lower(license_number))
  where license_number is not null;

create table if not exists public.license_renewals (
  id                   uuid primary key default gen_random_uuid(),
  license_id           uuid not null references public.licenses(id) on delete cascade,
  renewed_on           date not null,
  previous_expiry_date date null,
  new_expiry_date      date null,
  ceu_hours_completed  numeric(7,2) null,
  notes                text null,
  recorded_by          uuid null references public.staff(id) on delete set null,
  recorded_at          timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  legacy_id            text null,
  source_system        text null,
  constraint license_renewals_id_license_unique unique (id, license_id),
  constraint license_renewals_ceu_non_negative
    check (ceu_hours_completed is null or ceu_hours_completed >= 0),
  constraint license_renewals_expiry_progression
    check (
      previous_expiry_date is null
      or new_expiry_date is null
      or previous_expiry_date <= new_expiry_date
    )
);

create index if not exists license_renewals_license_idx
  on public.license_renewals (license_id, renewed_on desc);
create index if not exists license_renewals_recorded_by_idx
  on public.license_renewals (recorded_by)
  where recorded_by is not null;

create table if not exists public.license_documents (
  id                uuid primary key default gen_random_uuid(),
  license_id        uuid not null references public.licenses(id) on delete cascade,
  renewal_id        uuid null,
  document_kind     text not null,
  storage_path      text not null unique,
  media_type        text not null,
  original_filename text null,
  file_size_bytes   integer null,
  uploaded_by       uuid null references public.staff(id) on delete set null,
  uploaded_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  legacy_id         text null,
  source_system     text null,
  -- A document may cite only a renewal of its own license.
  constraint license_documents_renewal_same_license
    foreign key (renewal_id, license_id)
    references public.license_renewals (id, license_id)
    on delete set null (renewal_id),
  constraint license_documents_kind_valid
    check (document_kind in ('card', 'certificate', 'coi')),
  constraint license_documents_media_type_valid
    check (media_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  constraint license_documents_file_size_non_negative
    check (file_size_bytes is null or file_size_bytes >= 0)
);

create index if not exists license_documents_license_idx
  on public.license_documents (license_id, uploaded_at desc);
create index if not exists license_documents_renewal_idx
  on public.license_documents (renewal_id)
  where renewal_id is not null;

create or replace function public.record_license_renewal(
  p_license_id uuid,
  p_renewed_on date,
  p_new_expiry_date date,
  p_ceu_hours_completed numeric,
  p_notes text
)
returns uuid
language plpgsql
-- Definer so renewal history is written only here: authenticated holds no
-- INSERT on license_renewals, so recorded_by and previous_expiry_date cannot
-- be forged through the Data API. The staff check below is the gate.
security definer
set search_path = public
as $$
declare
  v_previous_expiry_date date;
  v_renewal_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select expiry_date
    into v_previous_expiry_date
    from public.licenses
   where id = p_license_id
   for update;

  if not found then
    raise exception 'License not found.' using errcode = 'P0002';
  end if;

  if v_previous_expiry_date is not null and p_new_expiry_date is null then
    raise exception 'A new expiry date is required to renew a license that expires.'
      using errcode = '22023';
  end if;

  insert into public.license_renewals (
    license_id,
    renewed_on,
    previous_expiry_date,
    new_expiry_date,
    ceu_hours_completed,
    notes,
    recorded_by
  )
  values (
    p_license_id,
    p_renewed_on,
    v_previous_expiry_date,
    p_new_expiry_date,
    p_ceu_hours_completed,
    p_notes,
    auth.uid()
  )
  returning id into v_renewal_id;

  if p_new_expiry_date is not null or v_previous_expiry_date is not null then
    update public.licenses
       set expiry_date = p_new_expiry_date,
           updated_at = now()
     where id = p_license_id
       and expiry_date is not distinct from v_previous_expiry_date;

    if not found then
      raise exception 'License changed during renewal.' using errcode = '40001';
    end if;
  end if;

  return v_renewal_id;
end;
$$;

revoke all on function public.record_license_renewal(uuid, date, date, numeric, text) from public, anon;
grant execute on function public.record_license_renewal(uuid, date, date, numeric, text)
  to authenticated;

-- Data API grants. These tables are reached through getSupabaseServerClient(),
-- which runs as the authenticated API role under RLS. The project's default
-- privileges grant every verb on new tables (Cairn #2791, see 0094), so revoke
-- first: the grants below are then the whole of what each role holds. Licenses
-- are never deleted, and renewal history is written only by the RPC above.
revoke all on public.licenses, public.license_renewals, public.license_documents
  from anon, authenticated;
grant select, insert, update on public.licenses to authenticated;
grant select                 on public.license_renewals to authenticated;
grant select, insert, delete on public.license_documents to authenticated;

-- RLS. Per WAL-580 every client receives this aggregate schema, so these
-- policies must hold even for clients that do not enable the licensing UI.
alter table public.licenses enable row level security;
alter table public.license_renewals enable row level security;
alter table public.license_documents enable row level security;

drop policy if exists "licensing_staff_all_licenses" on public.licenses;
drop policy if exists "licensing_staff_selects_licenses" on public.licenses;
create policy "licensing_staff_selects_licenses"
  on public.licenses for select to authenticated
  using (public.is_staff());
drop policy if exists "licensing_staff_inserts_licenses" on public.licenses;
create policy "licensing_staff_inserts_licenses"
  on public.licenses for insert to authenticated
  with check (public.is_staff());
drop policy if exists "licensing_staff_updates_licenses" on public.licenses;
create policy "licensing_staff_updates_licenses"
  on public.licenses for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "licensing_staff_all_license_renewals" on public.license_renewals;
drop policy if exists "licensing_staff_selects_license_renewals" on public.license_renewals;
create policy "licensing_staff_selects_license_renewals"
  on public.license_renewals for select to authenticated
  using (public.is_staff());

drop policy if exists "licensing_staff_all_license_documents" on public.license_documents;
drop policy if exists "licensing_staff_selects_license_documents" on public.license_documents;
create policy "licensing_staff_selects_license_documents"
  on public.license_documents for select to authenticated
  using (public.is_staff());
drop policy if exists "licensing_staff_inserts_license_documents" on public.license_documents;
create policy "licensing_staff_inserts_license_documents"
  on public.license_documents for insert to authenticated
  with check (public.is_staff() and uploaded_by = auth.uid());
drop policy if exists "licensing_staff_deletes_license_documents" on public.license_documents;
create policy "licensing_staff_deletes_license_documents"
  on public.license_documents for delete to authenticated
  using (public.is_staff());

-- Private bucket. License scans are legal/financial records: never public.
insert into storage.buckets (id, name, public)
values ('license-documents', 'license-documents', false)
on conflict (id) do nothing;

drop policy if exists "licensing_staff_selects_license_documents_objects" on storage.objects;
create policy "licensing_staff_selects_license_documents_objects"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'license-documents' and public.is_staff());

drop policy if exists "licensing_staff_inserts_license_documents_objects" on storage.objects;
create policy "licensing_staff_inserts_license_documents_objects"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'license-documents' and public.is_staff());

drop policy if exists "licensing_staff_updates_license_documents_objects" on storage.objects;
create policy "licensing_staff_updates_license_documents_objects"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'license-documents' and public.is_staff())
  with check (bucket_id = 'license-documents' and public.is_staff());

drop policy if exists "licensing_staff_deletes_license_documents_objects" on storage.objects;
create policy "licensing_staff_deletes_license_documents_objects"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'license-documents' and public.is_staff());
