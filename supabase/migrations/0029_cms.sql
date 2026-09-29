-- CMS module: content singletons (generalizes site_content from module-catalog)

create table if not exists public.content_singletons (
  key         text primary key,
  value       jsonb not null default 'null',
  updated_at  timestamptz not null default now()
);

comment on table public.content_singletons is
  'Editable marketing copy (announcement bar, hero, hours, etc.). Owned by CMS module; staff-managed.';

alter table public.content_singletons enable row level security;

-- public read
drop policy if exists "cms_public_reads_content_singletons" on public.content_singletons;
create policy "cms_public_reads_content_singletons"
  on public.content_singletons for select using (true);

-- staff insert
drop policy if exists "cms_staff_inserts_content_singletons" on public.content_singletons;
create policy "cms_staff_inserts_content_singletons"
  on public.content_singletons for insert
  to authenticated
  with check (public.is_staff());

-- staff update
drop policy if exists "cms_staff_updates_content_singletons" on public.content_singletons;
create policy "cms_staff_updates_content_singletons"
  on public.content_singletons for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- seed default keys idempotently
insert into public.content_singletons (key, value)
values
  ('homepage.topbar', 'null'::jsonb),
  ('homepage.hero_lede', 'null'::jsonb),
  ('homepage.hours_note', 'null'::jsonb)
on conflict (key) do nothing;
