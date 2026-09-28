-- Receptionist module schema. Owns calls.
--
-- RUNTIME PATH: all reads/writes go through the service-role client
-- (data-supabase/service), which bypasses RLS, behind the deny-by-default
-- authorize gate in routes.ts (staff GET/PATCH) and the x-vapi-secret gate
-- (inbound webhook POST).
--
-- FORWARD PATH: is_staff() RLS policies are defined here so a future
-- session-scoped staff client needs no new migration to work.
--
-- Prereq: module-admin migration (public.is_staff()) must be applied first.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'call_status'
  ) then
    create type public.call_status as enum (
      'queued',
      'ringing',
      'in-progress',
      'forwarding',
      'ended'
    );
  end if;
end;
$$;

-- calls: one row per Vapi call, keyed by the Vapi call id so webhook events
-- (status-update, then end-of-call-report) upsert the same row.
create table if not exists public.calls (
  id                uuid primary key default gen_random_uuid(),
  vapi_call_id      text not null unique,
  direction         text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  from_number       text,
  to_number         text,
  status            public.call_status not null default 'queued',
  ended_reason      text,
  started_at        timestamptz,
  ended_at          timestamptz,
  duration_seconds  integer,
  transcript        text,
  summary           text,
  recording_url     text,
  escalated         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.calls is
  'Owned by @waltersignal/bananaforce-module-receptionist. One row per Vapi call, upserted across status-update and end-of-call-report webhook events. Service-role managed; no anon/authenticated write path.';

create index if not exists calls_started_at_idx
  on public.calls (started_at desc);

create index if not exists calls_status_idx
  on public.calls (status);

create or replace function public.receptionist_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists receptionist_calls_updated_at on public.calls;
create trigger receptionist_calls_updated_at
  before update on public.calls
  for each row execute function public.receptionist_set_updated_at();

-- RLS: enabled, all access denied to anon/authenticated. Service-role bypasses
-- RLS at runtime. Staff policies below are the forward path.

alter table public.calls enable row level security;
revoke all on public.calls from anon, authenticated;

-- ===========================================================================
-- Staff-scoped RLS policies (FORWARD PATH).
-- Additive receptionist_staff_* names; idempotent via drop-if-exists guard.
-- Keyed off public.is_staff() (owned by module-admin — do NOT recreate here).
-- ===========================================================================

drop policy if exists "receptionist_staff_reads_calls" on public.calls;
create policy "receptionist_staff_reads_calls"
  on public.calls
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "receptionist_staff_updates_calls" on public.calls;
create policy "receptionist_staff_updates_calls"
  on public.calls
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());
