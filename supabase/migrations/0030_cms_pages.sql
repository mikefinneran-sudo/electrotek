-- CMS module: content pages and typed content blocks

create table if not exists public.content_pages (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  title        text not null,
  seo          jsonb not null default '{}',
  status       text not null default 'draft'
                 check (status in ('draft', 'published')),
  published_at timestamptz,
  sort_order   int not null default 0,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

comment on table public.content_pages is
  'Slug-addressed marketing pages composed of ordered typed blocks. Owned by CMS module; staff-managed. Anon reads published only.';

create table if not exists public.content_blocks (
  id         uuid primary key default gen_random_uuid(),
  page_id    uuid not null references public.content_pages(id) on delete cascade,
  type       text not null,
  data       jsonb not null default '{}',
  sort_order int not null,
  created_at timestamptz default now()
);

comment on table public.content_blocks is
  'Ordered typed blocks (hero, rich_text, image, cta, faq, gallery) belonging to a content_page. Owned by CMS module.';

alter table public.content_pages enable row level security;
alter table public.content_blocks enable row level security;

-- content_pages: anon/public can only read published pages
drop policy if exists "cms_public_reads_content_pages" on public.content_pages;
create policy "cms_public_reads_content_pages"
  on public.content_pages for select
  using (status = 'published');

-- content_pages: staff can read all (including drafts)
drop policy if exists "cms_staff_selects_content_pages" on public.content_pages;
create policy "cms_staff_selects_content_pages"
  on public.content_pages for select
  to authenticated
  using (public.is_staff());

-- content_pages: staff write
drop policy if exists "cms_staff_inserts_content_pages" on public.content_pages;
create policy "cms_staff_inserts_content_pages"
  on public.content_pages for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "cms_staff_updates_content_pages" on public.content_pages;
create policy "cms_staff_updates_content_pages"
  on public.content_pages for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "cms_staff_deletes_content_pages" on public.content_pages;
create policy "cms_staff_deletes_content_pages"
  on public.content_pages for delete
  to authenticated
  using (public.is_staff());

-- content_blocks: anon/public can only read blocks belonging to published pages
drop policy if exists "cms_public_reads_content_blocks" on public.content_blocks;
create policy "cms_public_reads_content_blocks"
  on public.content_blocks for select
  using (
    exists (
      select 1 from public.content_pages p
      where p.id = content_blocks.page_id
        and p.status = 'published'
    )
  );

-- content_blocks: staff can read all
drop policy if exists "cms_staff_selects_content_blocks" on public.content_blocks;
create policy "cms_staff_selects_content_blocks"
  on public.content_blocks for select
  to authenticated
  using (public.is_staff());

-- content_blocks: staff write
drop policy if exists "cms_staff_inserts_content_blocks" on public.content_blocks;
create policy "cms_staff_inserts_content_blocks"
  on public.content_blocks for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "cms_staff_updates_content_blocks" on public.content_blocks;
create policy "cms_staff_updates_content_blocks"
  on public.content_blocks for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "cms_staff_deletes_content_blocks" on public.content_blocks;
create policy "cms_staff_deletes_content_blocks"
  on public.content_blocks for delete
  to authenticated
  using (public.is_staff());
