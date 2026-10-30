-- Projects module: staff-managed projects, review items, versions, members,
-- and comments. Client token access arrives in a later application slice;
-- every Data API policy in this migration is staff-only.

create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  client_name text not null check (char_length(btrim(client_name)) between 1 and 200),
  account_id uuid null references public.accounts(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'archived')),
  created_by uuid not null references public.staff(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  email text not null check (
    char_length(email) between 3 and 254
    and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  token_version integer not null default 1 check (token_version > 0),
  last_seen_at timestamptz null,
  created_at timestamptz not null default now()
);

create unique index if not exists project_members_project_email_key
  on public.project_members (project_id, lower(email));

create table if not exists public.project_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('file', 'link')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  url text null check (url is null or char_length(url) between 1 and 2048),
  review_status text not null default 'in_review'
    check (review_status in ('in_review', 'changes_requested', 'approved')),
  decided_by_member_id uuid null references public.project_members(id) on delete set null,
  decided_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_items_kind_url_valid check (
    (kind = 'file' and url is null)
    or (kind = 'link' and url is not null)
  ),
  constraint project_items_decision_complete check (
    (review_status = 'in_review' and decided_by_member_id is null and decided_at is null)
    or (review_status <> 'in_review' and decided_by_member_id is not null and decided_at is not null)
  )
);

create table if not exists public.project_item_versions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.project_items(id) on delete cascade,
  version_no integer not null check (version_no > 0),
  storage_path text not null unique check (
    char_length(storage_path) between 1 and 1024
    and storage_path !~ '^/'
  ),
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (
    mime_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf')
  ),
  size_bytes bigint not null check (size_bytes between 1 and 26214400),
  created_at timestamptz not null default now(),
  constraint project_item_versions_item_version_key unique (item_id, version_no)
);

create table if not exists public.project_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  item_id uuid null references public.project_items(id) on delete cascade,
  version_id uuid null references public.project_item_versions(id) on delete cascade,
  parent_id uuid null references public.project_comments(id) on delete cascade,
  author_staff_id uuid null references public.staff(id) on delete set null,
  author_member_id uuid null references public.project_members(id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  pin_x double precision null,
  pin_y double precision null,
  page_no integer null check (page_no is null or page_no > 0),
  visibility text not null default 'shared'
    check (visibility in ('shared', 'internal')),
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_comments_author_xor check (
    (author_staff_id is not null) <> (author_member_id is not null)
  ),
  constraint project_comments_internal_staff_only check (
    visibility <> 'internal' or author_staff_id is not null
  ),
  constraint project_comments_pin_pair_valid check (
    (pin_x is null and pin_y is null)
    or (pin_x between 0 and 1 and pin_y between 0 and 1)
  )
);

create index if not exists projects_account_id_idx on public.projects (account_id);
create index if not exists projects_status_updated_idx
  on public.projects (status, updated_at desc);
create index if not exists project_members_project_id_idx
  on public.project_members (project_id);
create index if not exists project_items_project_id_idx
  on public.project_items (project_id, created_at desc);
create index if not exists project_item_versions_item_id_idx
  on public.project_item_versions (item_id, version_no desc);
create index if not exists project_comments_project_id_idx
  on public.project_comments (project_id, created_at);
create index if not exists project_comments_item_id_idx
  on public.project_comments (item_id, created_at);
create index if not exists project_comments_version_id_idx
  on public.project_comments (version_id, created_at);
create index if not exists project_comments_parent_id_idx
  on public.project_comments (parent_id, created_at);

create or replace function public.projects_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.projects_set_updated_at() from public;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.projects_set_updated_at();

drop trigger if exists project_items_set_updated_at on public.project_items;
create trigger project_items_set_updated_at
  before update on public.project_items
  for each row execute function public.projects_set_updated_at();

drop trigger if exists project_comments_set_updated_at on public.project_comments;
create trigger project_comments_set_updated_at
  before update on public.project_comments
  for each row execute function public.projects_set_updated_at();

-- Pins are meaningful only against image bytes. The paired/range check above
-- handles geometry; this trigger validates the referenced version's media type.
create or replace function public.projects_validate_comment_pin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mime_type text;
begin
  if new.pin_x is null and new.pin_y is null then
    return new;
  end if;

  if new.version_id is null then
    raise exception 'pinned comments require a version';
  end if;

  select version.mime_type
    into v_mime_type
    from public.project_item_versions version
    where version.id = new.version_id;

  if v_mime_type is null or v_mime_type not like 'image/%' then
    raise exception 'pins are allowed only on image versions';
  end if;

  return new;
end;
$$;

revoke all on function public.projects_validate_comment_pin() from public;

drop trigger if exists project_comments_validate_pin on public.project_comments;
create trigger project_comments_validate_pin
  before insert or update of pin_x, pin_y, version_id on public.project_comments
  for each row execute function public.projects_validate_comment_pin();

-- Data API grants precede RLS: new Supabase projects grant new tables nothing.
-- No project table privileges are granted to anon.
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_members to authenticated;
grant select, insert, update, delete on public.project_items to authenticated;
grant select, insert, update, delete on public.project_item_versions to authenticated;
grant select, insert, update, delete on public.project_comments to authenticated;

revoke all on public.projects from anon;
revoke all on public.project_members from anon;
revoke all on public.project_items from anon;
revoke all on public.project_item_versions from anon;
revoke all on public.project_comments from anon;

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_items enable row level security;
alter table public.project_item_versions enable row level security;
alter table public.project_comments enable row level security;

drop policy if exists "projects_staff_all_projects" on public.projects;
create policy "projects_staff_all_projects"
  on public.projects for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "projects_staff_all_members" on public.project_members;
create policy "projects_staff_all_members"
  on public.project_members for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "projects_staff_all_items" on public.project_items;
create policy "projects_staff_all_items"
  on public.project_items for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "projects_staff_all_versions" on public.project_item_versions;
create policy "projects_staff_all_versions"
  on public.project_item_versions for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "projects_staff_all_comments" on public.project_comments;
create policy "projects_staff_all_comments"
  on public.project_comments for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Insert the item and version 1 in one database transaction after Storage has
-- accepted the object. The caller removes that object if this RPC fails.
create or replace function public.create_project_file_item(
  p_item_id uuid,
  p_project_id uuid,
  p_title text,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint
) returns uuid
language plpgsql
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'staff access required' using errcode = '42501';
  end if;

  insert into public.project_items (id, project_id, kind, title)
  values (p_item_id, p_project_id, 'file', btrim(p_title));

  insert into public.project_item_versions (
    item_id, version_no, storage_path, file_name, mime_type, size_bytes
  ) values (
    p_item_id, 1, p_storage_path, p_file_name, p_mime_type, p_size_bytes
  );

  update public.projects set updated_at = now() where id = p_project_id;
  return p_item_id;
end;
$$;

revoke all on function public.create_project_file_item(
  uuid, uuid, text, text, text, text, bigint
) from public;
grant execute on function public.create_project_file_item(
  uuid, uuid, text, text, text, text, bigint
) to authenticated;

-- Private Storage bucket with the same validation limits as the route and
-- project_item_versions table.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-files',
  'project-files',
  false,
  26214400,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "projects_staff_selects_file_objects" on storage.objects;
create policy "projects_staff_selects_file_objects"
  on storage.objects for select to authenticated
  using (bucket_id = 'project-files' and public.is_staff());

drop policy if exists "projects_staff_inserts_file_objects" on storage.objects;
create policy "projects_staff_inserts_file_objects"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'project-files' and public.is_staff());

drop policy if exists "projects_staff_deletes_file_objects" on storage.objects;
create policy "projects_staff_deletes_file_objects"
  on storage.objects for delete to authenticated
  using (bucket_id = 'project-files' and public.is_staff());
