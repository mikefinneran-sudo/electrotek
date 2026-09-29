-- Communications module schema. Owns message_threads and messages.
--
-- RUNTIME PATH: all reads/writes go through the service-role client
-- (data-supabase/service), which bypasses RLS, behind the deny-by-default
-- authorize gate in routes.ts.
--
-- FORWARD PATH: is_staff() RLS policies are defined here so a future session-
-- scoped staff client needs no new migration to work.
--
-- Prereq: module-admin migration (public.is_staff()) must be applied first.

create extension if not exists pgcrypto;

-- Enum for message delivery status. Guarded by a do-block so the migration is
-- idempotent and does not fail when re-applied.
do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'message_status'
  ) then
    create type public.message_status as enum (
      'queued',
      'sent',
      'delivered',
      'failed',
      'received'
    );
  end if;
end;
$$;

-- message_threads: one row per conversation. Optionally scoped to an
-- inspection via inspection_id (plain uuid, no FK across module boundaries).
create table if not exists public.message_threads (
  id          uuid primary key default gen_random_uuid(),
  inspection_id uuid,
  subject     text not null default '',
  channel     text not null check (channel in ('sms', 'email')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.message_threads is
  'Owned by @waltersignal/bananaforce-module-communications. One row per message thread; optionally scoped to an inspection. Service-role managed; no anon/authenticated write path.';

create index if not exists message_threads_inspection_id_idx
  on public.message_threads (inspection_id);

-- updated_at trigger: module-scoped function name to avoid clashes.
create or replace function public.communications_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists communications_threads_updated_at on public.message_threads;
create trigger communications_threads_updated_at
  before update on public.message_threads
  for each row execute function public.communications_set_updated_at();

-- messages: one row per message sent or received on a thread.
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.message_threads(id) on delete cascade,
  channel     text not null check (channel in ('sms', 'email')),
  direction   text not null check (direction in ('outbound', 'inbound')),
  to_address  text,
  from_address text,
  body        text,
  status      public.message_status not null default 'queued',
  provider_id text,
  created_at  timestamptz not null default now()
);

comment on table public.messages is
  'Owned by @waltersignal/bananaforce-module-communications. One row per outbound or inbound message. Service-role managed.';

create index if not exists messages_thread_id_idx
  on public.messages (thread_id);

create index if not exists messages_status_idx
  on public.messages (status);

-- RLS: enabled, all access denied to anon/authenticated. Service-role bypasses
-- RLS at runtime. Staff policies below are the forward path.

alter table public.message_threads enable row level security;
revoke all on public.message_threads from anon, authenticated;

alter table public.messages enable row level security;
revoke all on public.messages from anon, authenticated;

-- ===========================================================================
-- Staff-scoped RLS policies (FORWARD PATH).
-- Additive communications_staff_* names; idempotent via drop-if-exists guard.
-- Keyed off public.is_staff() (owned by module-admin — do NOT recreate here).
-- ===========================================================================

-- message_threads: staff may read, create, and update threads.

drop policy if exists "communications_staff_reads_threads" on public.message_threads;
create policy "communications_staff_reads_threads"
  on public.message_threads
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "communications_staff_inserts_threads" on public.message_threads;
create policy "communications_staff_inserts_threads"
  on public.message_threads
  for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "communications_staff_updates_threads" on public.message_threads;
create policy "communications_staff_updates_threads"
  on public.message_threads
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- messages: staff may read all messages and insert new ones.

drop policy if exists "communications_staff_reads_messages" on public.messages;
create policy "communications_staff_reads_messages"
  on public.messages
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "communications_staff_inserts_messages" on public.messages;
create policy "communications_staff_inserts_messages"
  on public.messages
  for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "communications_staff_updates_messages" on public.messages;
create policy "communications_staff_updates_messages"
  on public.messages
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());
