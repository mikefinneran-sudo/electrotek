-- Visit checkflow module schema. Owns the per-visit signoff stack that sits on
-- top of the quote-engine's inspections + task_library (Wave 2). It owns NEW
-- tables only: checklists, checklist_items, visit_signoffs,
-- visit_item_completions, and visit_photos. It references public.inspections and
-- public.task_library (owned by quote-engine) read-only; it does not create,
-- alter, or seed them.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'checklist_status'
      and n.nspname = 'public'
  ) then
    create type public.checklist_status as enum (
      'draft',
      'active',
      'archived'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'visit_status'
      and n.nspname = 'public'
  ) then
    create type public.visit_status as enum (
      'complete',
      'partial',
      'issue'
    );
  end if;
end
$$;

-- One generated checklist per inspection. The checklist itself is just a header;
-- its rows live in checklist_items. status drives whether crew see it.
create table if not exists public.checklists (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  status public.checklist_status not null default 'active',
  created_at timestamptz not null default now()
);

-- One active (non-archived) checklist per inspection. Partial unique index so
-- archived checklists don't block regenerating a fresh one. This is what makes
-- generateChecklistFromInspection idempotent at the database level.
create unique index if not exists checklists_one_active_per_inspection
  on public.checklists (inspection_id)
  where status <> 'archived';

create table if not exists public.checklist_items (
  id serial primary key,
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  task text not null,
  frequency text,
  frequency_detail text,
  area text,
  sort_order numeric not null default 0,
  active boolean not null default true,
  source text,
  notes text
);

-- The per-visit signoff header. tasks_done/tasks_total and status are derived
-- by server.ts from the item completions at write time. submission_id is a
-- client-supplied idempotency key (crypto.randomUUID) — unique so a retried
-- submit returns the existing visit instead of duplicating it.
create table if not exists public.visit_signoffs (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  checklist_id uuid references public.checklists(id),
  visit_date date not null default current_date,
  completed_at timestamptz,
  signed_by text,
  status public.visit_status not null default 'issue',
  tasks_done integer,
  tasks_total integer,
  notes text,
  submission_id text unique,
  created_at timestamptz not null default now()
);

-- Per-item completion rows for a visit. Replaces ABC's Item Completions JSON
-- blob with first-class rows. checklist_item_id is integer to match
-- checklist_items.id (serial); it stays nullable + on delete set null so a
-- visit's history survives even if a checklist item is later removed.
create table if not exists public.visit_item_completions (
  id serial primary key,
  visit_id uuid not null references public.visit_signoffs(id) on delete cascade,
  checklist_item_id integer references public.checklist_items(id) on delete set null,
  done boolean not null default false,
  note text
);

-- Per-visit photo rows. Replaces ABC's Photo URLs JSON blob. The bytes live in
-- the private `visit-photos` Storage bucket; storage_path is the object key
-- within it. No public URL is stored — reads go through signed URLs minted by
-- the service-role client.
create table if not exists public.visit_photos (
  id serial primary key,
  visit_id uuid not null references public.visit_signoffs(id) on delete cascade,
  storage_path text,
  role text,
  filename text,
  content_type text,
  size integer,
  uploaded_at timestamptz not null default now()
);

create index if not exists checklists_inspection_id_idx
  on public.checklists (inspection_id);
create index if not exists checklist_items_checklist_id_idx
  on public.checklist_items (checklist_id);
create index if not exists checklist_items_sort_order_idx
  on public.checklist_items (sort_order);
create index if not exists visit_signoffs_inspection_id_idx
  on public.visit_signoffs (inspection_id);
create index if not exists visit_signoffs_checklist_id_idx
  on public.visit_signoffs (checklist_id);
create index if not exists visit_signoffs_visit_date_idx
  on public.visit_signoffs (visit_date);
create index if not exists visit_item_completions_visit_id_idx
  on public.visit_item_completions (visit_id);
create index if not exists visit_photos_visit_id_idx
  on public.visit_photos (visit_id);

comment on table public.checklists is
  'Owned by @waltersignal/bananaforce-module-visit-checkflow. One active checklist per inspection (generated from inspection scope + task_library). Staff/service-role managed: no anon or authenticated access until the admin/crew modules add staff-scoped RLS policies.';
comment on table public.checklist_items is
  'Owned by @waltersignal/bananaforce-module-visit-checkflow. The task rows of a checklist. Staff/service-role managed (same posture as checklists).';
comment on table public.visit_signoffs is
  'Owned by @waltersignal/bananaforce-module-visit-checkflow. Per-visit crew signoff header; tasks_done/tasks_total/status are derived at write time. submission_id is a client idempotency key. Staff/service-role managed.';
comment on table public.visit_item_completions is
  'Owned by @waltersignal/bananaforce-module-visit-checkflow. Per-item completion rows for a visit. Replaces ABC''s Item Completions JSON. Staff/service-role managed.';
comment on table public.visit_photos is
  'Owned by @waltersignal/bananaforce-module-visit-checkflow. Per-visit before/after photo metadata; bytes live in the private visit-photos Storage bucket. Replaces ABC''s Photo URLs JSON. Staff/service-role managed.';

alter table public.checklists enable row level security;
alter table public.checklist_items enable row level security;
alter table public.visit_signoffs enable row level security;
alter table public.visit_item_completions enable row level security;
alter table public.visit_photos enable row level security;

revoke all on public.checklists from anon, authenticated;
revoke all on public.checklist_items from anon, authenticated;
revoke all on public.visit_signoffs from anon, authenticated;
revoke all on public.visit_item_completions from anon, authenticated;
revoke all on public.visit_photos from anon, authenticated;

-- All five tables are staff/crew-only and served via the RLS-bypassing
-- service-role client in server.ts. No grants and no policies for anon or
-- authenticated: with RLS enabled, every operation is denied by default. Staff/
-- crew-scoped read/write policies arrive with the admin/crew module (Wave 2/3),
-- keyed off a staff-auth check — mirrors the quote-engine posture exactly. We do
-- NOT grant to `authenticated`: in a shared Supabase project the catalog
-- module's retail customers are `authenticated` too, and have no business
-- reading crew checklists, visit signoffs, or job-site photos.
