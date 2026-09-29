-- CMS module: media library (storage bucket + content_media table)

create table if not exists public.content_media (
  id         uuid primary key default gen_random_uuid(),
  path       text not null unique,
  alt        text,
  width      int,
  height     int,
  bytes      int,
  mime       text,
  created_at timestamptz default now()
);

comment on table public.content_media is
  'Uploaded media assets (images) stored in Supabase Storage bucket cms-media. Owned by CMS module; staff-managed, public-read for assets referenced by published pages.';

alter table public.content_media enable row level security;

-- public/anon SELECT: media referenced by published pages must load
drop policy if exists "cms_public_selects_content_media" on public.content_media;
create policy "cms_public_selects_content_media"
  on public.content_media for select using (true);

-- staff insert
drop policy if exists "cms_staff_inserts_content_media" on public.content_media;
create policy "cms_staff_inserts_content_media"
  on public.content_media for insert
  to authenticated
  with check (public.is_staff());

-- staff update
drop policy if exists "cms_staff_updates_content_media" on public.content_media;
create policy "cms_staff_updates_content_media"
  on public.content_media for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- staff delete
drop policy if exists "cms_staff_deletes_content_media" on public.content_media;
create policy "cms_staff_deletes_content_media"
  on public.content_media for delete
  to authenticated
  using (public.is_staff());

-- ---------------------------------------------------------------------------
-- Storage bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('cms-media', 'cms-media', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Storage RLS on storage.objects scoped to cms-media bucket
-- ---------------------------------------------------------------------------

-- public/anon read (objects in the bucket are publicly accessible)
drop policy if exists "cms_public_selects_cms_media_objects" on storage.objects;
create policy "cms_public_selects_cms_media_objects"
  on storage.objects for select
  using (bucket_id = 'cms-media');

-- staff insert
drop policy if exists "cms_staff_inserts_cms_media_objects" on storage.objects;
create policy "cms_staff_inserts_cms_media_objects"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'cms-media' and public.is_staff());

-- staff update
drop policy if exists "cms_staff_updates_cms_media_objects" on storage.objects;
create policy "cms_staff_updates_cms_media_objects"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'cms-media' and public.is_staff());

-- staff delete
drop policy if exists "cms_staff_deletes_cms_media_objects" on storage.objects;
create policy "cms_staff_deletes_cms_media_objects"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'cms-media' and public.is_staff());
