-- Private forensic-inquiry attachments for public lead submissions.

create table if not exists public.lead_attachments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  storage_path text not null unique check (
    char_length(storage_path) between 1 and 1024
    and storage_path !~ '^/'
  ),
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (
    mime_type in (
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/gif',
      'image/jpeg',
      'image/png',
      'image/webp'
    )
  ),
  size_bytes bigint not null check (size_bytes between 0 and 10485760),
  created_at timestamptz not null default now()
);

create index if not exists lead_attachments_lead_id_idx
  on public.lead_attachments (lead_id);

comment on table public.lead_attachments is
  'Private files submitted with public leads. Objects live in the lead-attachments Storage bucket.';

-- Data API grants must precede RLS policies. New Supabase projects grant new
-- tables no privileges, so policies alone would otherwise be dead code.
grant insert on public.lead_attachments to anon, authenticated;
grant select on public.lead_attachments to authenticated;

alter table public.lead_attachments enable row level security;

-- The public route runs as anon when no visitor session exists. It may insert
-- attachment metadata, but receives no SELECT/UPDATE/DELETE access to either
-- leads or lead_attachments. The FK is the only lead relationship disclosed.
drop policy if exists "lead_capture_public_inserts_attachments" on public.lead_attachments;
create policy "lead_capture_public_inserts_attachments"
  on public.lead_attachments for insert
  to anon, authenticated
  with check (true);

drop policy if exists "lead_capture_staff_reads_attachments" on public.lead_attachments;
create policy "lead_capture_staff_reads_attachments"
  on public.lead_attachments for select
  to authenticated
  using (public.is_staff());

-- Private bucket: public visitors may upload, while only staff may read. Bucket
-- constraints duplicate route/table validation as a final storage-layer guard.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lead-attachments',
  'lead-attachments',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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

drop policy if exists "lead_capture_public_uploads_attachments" on storage.objects;
create policy "lead_capture_public_uploads_attachments"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'lead-attachments');

drop policy if exists "lead_capture_staff_reads_attachment_objects" on storage.objects;
create policy "lead_capture_staff_reads_attachment_objects"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'lead-attachments' and public.is_staff());

-- File submissions use a separate RPC so today's no-file submit_lead path is
-- unchanged. The lead and every attachment row commit in one transaction after
-- the route has uploaded all objects successfully.
create or replace function public.submit_lead_with_attachments(
  p_name text,
  p_email text,
  p_company text default null,
  p_source text default null,
  p_phone text default null,
  p_office text default null,
  p_notes text default null,
  p_ip_hash text default null,
  p_user_agent text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_attachments jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_lead_id uuid;
  v_attachment jsonb;
  v_storage_path text;
  v_file_name text;
  v_mime_type text;
  v_size_bytes bigint;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'name is required';
  end if;

  if v_email is null and v_phone is null then
    raise exception 'an email address or a phone number is required';
  end if;

  if v_email is not null
     and (v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          or char_length(v_email) > 254) then
    raise exception 'a valid email is required';
  end if;

  if char_length(btrim(p_name)) > 200
     or char_length(btrim(coalesce(p_company, ''))) > 200
     or char_length(coalesce(p_notes, '')) > 5000
     or char_length(coalesce(v_phone, '')) > 50
     or char_length(coalesce(p_office, '')) > 300
     or char_length(coalesce(p_source, '')) > 100 then
    raise exception 'field too long';
  end if;

  if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
    raise exception 'attachments must be an array';
  end if;

  insert into public.leads (
    status, source, name, company, email, phone, office, notes, ip_hash, user_agent, metadata
  ) values (
    'new',
    p_source,
    btrim(p_name),
    nullif(btrim(coalesce(p_company, '')), ''),
    lower(v_email),
    v_phone,
    p_office,
    p_notes,
    p_ip_hash,
    p_user_agent,
    coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_lead_id;

  for v_attachment in
    select value from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb))
  loop
    if jsonb_typeof(v_attachment) <> 'object' then
      raise exception 'attachment must be an object';
    end if;

    v_storage_path := btrim(coalesce(v_attachment ->> 'storage_path', ''));
    v_file_name := btrim(coalesce(v_attachment ->> 'file_name', ''));
    v_mime_type := lower(btrim(coalesce(v_attachment ->> 'mime_type', '')));

    if coalesce(v_attachment ->> 'size_bytes', '') !~ '^[0-9]+$' then
      raise exception 'attachment size is invalid';
    end if;
    v_size_bytes := (v_attachment ->> 'size_bytes')::bigint;

    if char_length(v_storage_path) not between 1 and 1024
       or v_storage_path ~ '^/'
       or char_length(v_file_name) not between 1 and 255
       or v_mime_type not in (
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'image/gif',
         'image/jpeg',
         'image/png',
         'image/webp'
       )
       or v_size_bytes not between 0 and 10485760 then
      raise exception 'attachment is invalid';
    end if;

    insert into public.lead_attachments (
      lead_id, storage_path, file_name, mime_type, size_bytes
    ) values (
      v_lead_id, v_storage_path, v_file_name, v_mime_type, v_size_bytes
    );
  end loop;

  return v_lead_id;
end;
$$;

revoke all on function public.submit_lead_with_attachments(
  text, text, text, text, text, text, text, text, text, jsonb, jsonb
) from public;
grant execute on function public.submit_lead_with_attachments(
  text, text, text, text, text, text, text, text, text, jsonb, jsonb
) to anon, authenticated;
