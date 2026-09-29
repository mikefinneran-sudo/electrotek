-- Ticketing module schema. Owns tickets and ticket_replies tables.
-- Both surfaces are staff/service-role managed (no anon/authenticated access).
-- RLS enabled + revoke on both tables; additive ticketing_staff_* policies key
-- off public.is_staff() (owned by module-admin). The service-role client in
-- server.ts performs all reads and writes at runtime.
--
-- FUTURE MERGE: client-portal's issue_reports will become a ticket source
-- (channel='client', inspection_id set from the portal token). Do NOT modify
-- client-portal in this build — the merge is a Wave 2/3 data migration task.
--
-- Applies after: 0001_admin.sql (public.is_staff() must exist).

create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'ticket_status'
      and n.nspname = 'public'
  ) then
    create type public.ticket_status as enum (
      'open',
      'pending',
      'resolved',
      'closed'
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
    where t.typname = 'ticket_priority'
      and n.nspname = 'public'
  ) then
    create type public.ticket_priority as enum (
      'low',
      'normal',
      'high',
      'urgent'
    );
  end if;
end
$$;

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  -- inspection_id links to the client-portal token's inspection (plain uuid,
  -- NOT a FK to inspections at migration time — inspections may live in a
  -- separate Supabase project or be absent in ops-only deploys). NULL means
  -- the ticket is not tied to a specific client portal inspection.
  inspection_id uuid null,
  subject text not null,
  body text,
  status public.ticket_status not null default 'open',
  priority public.ticket_priority not null default 'normal',
  channel text not null default 'client'
    check (channel in ('internal', 'client')),
  requester_email text,
  -- assignee is the staff auth user id; set null on staff user removal.
  assignee uuid null,
  -- sla_due is computed at creation from priority (computeSlaDue in sla.ts).
  sla_due timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ticket_replies (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_kind text not null
    check (author_kind in ('staff', 'client')),
  author_label text,
  body text not null,
  -- internal=true means a staff-only note; never returned on the client path.
  internal boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists tickets_status_idx on public.tickets (status);
create index if not exists tickets_inspection_id_idx on public.tickets (inspection_id);
create index if not exists tickets_assignee_idx on public.tickets (assignee);
create index if not exists ticket_replies_ticket_id_idx on public.ticket_replies (ticket_id);

-- Keep tickets.updated_at current on every mutation. Module-scoped function
-- name avoids clashes with other modules' updated_at triggers.
create or replace function public.ticketing_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ticketing_tickets_set_updated_at on public.tickets;
create trigger ticketing_tickets_set_updated_at
  before update on public.tickets
  for each row execute function public.ticketing_set_updated_at();

comment on table public.tickets is
  'Owned by @waltersignal/bananaforce-module-ticketing. Helpdesk tickets with staff and client-facing surfaces. inspection_id (nullable, plain uuid) links to the client-portal token inspection for client-scoped access. Staff/service-role managed: RLS enabled, no anon/authenticated access at runtime. Staff RLS policies (forward path) key off public.is_staff().';

comment on table public.ticket_replies is
  'Owned by @waltersignal/bananaforce-module-ticketing. Per-ticket reply thread. internal=true rows are staff-only notes never returned to client token holders. Staff/service-role managed.';

alter table public.tickets enable row level security;
alter table public.ticket_replies enable row level security;

revoke all on public.tickets from anon, authenticated;
revoke all on public.ticket_replies from anon, authenticated;

-- Staff RLS policies (FORWARD PATH). At MVP runtime the service-role client
-- bypasses RLS so these policies are dormant. They become active when the app
-- switches to a staff session-scoped client (no migration needed at that point).
-- Each is additive: named ticketing_staff_* so it cannot clash with other
-- modules. Idempotent: drop if exists before create.

drop policy if exists ticketing_staff_select_tickets on public.tickets;
create policy ticketing_staff_select_tickets
  on public.tickets
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists ticketing_staff_insert_tickets on public.tickets;
create policy ticketing_staff_insert_tickets
  on public.tickets
  for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists ticketing_staff_update_tickets on public.tickets;
create policy ticketing_staff_update_tickets
  on public.tickets
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists ticketing_staff_select_replies on public.ticket_replies;
create policy ticketing_staff_select_replies
  on public.ticket_replies
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists ticketing_staff_insert_replies on public.ticket_replies;
create policy ticketing_staff_insert_replies
  on public.ticket_replies
  for insert
  to authenticated
  with check (public.is_staff());

-- No update/delete policy on ticket_replies: replies are insert-only in the
-- module (no editReply/deleteReply code path), so least-privilege means staff
-- get select+insert only on the forward session-scoped path. Add an update
-- policy here only when a reply-edit feature is explicitly planned.
