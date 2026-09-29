-- Quote lifecycle, part 2 of 2: durable estimate identity, validity window,
-- customer-facing access token, lifecycle timestamps, and transition guard.
--
-- Requires 0004_quote_lifecycle_enum.sql to have COMMITTED first (this file
-- references the 'viewed' and 'expired' labels it adds).
--
-- Security posture is UNCHANGED. No grants and no policies are added for anon.
-- The customer-facing preview follows the precedent set by module-client-portal
-- and module-contract-esign: the route verifies the token, then reads and writes
-- through the RLS-bypassing service-role client. The customer never receives a
-- database grant.

create extension if not exists pgcrypto;

-- --- durable estimate number ---------------------------------------------
--
-- Assigned at INSERT, not at send. Abandoned drafts therefore consume numbers
-- and the customer-visible sequence has gaps; that is the accepted trade for a
-- number that exists for the whole life of the record and never changes.
--
-- Before this migration the quote PDF used inspections.inspection_slug as the
-- displayed "Quote" number (pdf.ts), which is an internal routing key, not a
-- business document number.
--
-- The 'EST-' prefix is the shared default. A client app that needs its own
-- prefix supplies estimate_number explicitly on insert; the default only fills
-- when the column is omitted.

create sequence if not exists public.quote_engine_estimate_seq as bigint start 1;

alter table public.inspections
  add column if not exists estimate_number text not null
    default ('EST-' || lpad(nextval('public.quote_engine_estimate_seq')::text, 4, '0'));

-- Backfills every pre-existing row with a distinct number: a volatile default on
-- ADD COLUMN forces a table rewrite and is evaluated per row (not once).

create unique index if not exists inspections_estimate_number_key
  on public.inspections (estimate_number);

-- --- validity window ------------------------------------------------------
--
-- Nullable while drafting. Stamped on the transition into 'sent' (see the
-- trigger below) and then FIXED. pdf.ts previously recomputed validity as
-- today + 30 on every render, so re-downloading a quote silently extended its
-- own expiry. Persisting it makes the date a fact about the quote instead of a
-- fact about when the PDF was generated.

alter table public.inspections
  add column if not exists valid_until date;

-- --- customer-facing access token ----------------------------------------
--
-- Unguessable, unlike inspection_slug (which is derived and enumerable). This
-- is the ONLY credential on the customer preview route. It is a secret: never
-- log it, and never include it in a payload served to the customer.

alter table public.inspections
  add column if not exists public_token uuid not null default gen_random_uuid();

create unique index if not exists inspections_public_token_key
  on public.inspections (public_token);

-- --- lifecycle timestamps -------------------------------------------------
--
-- sent_at already exists (0001). These complete the audit trail so "when did
-- the customer actually look at this" is answerable — the Contractbook pattern
-- (per-recipient Viewing now / Not opened / Signed) that the Ascend onboarding
-- work needed and never got.

alter table public.inspections add column if not exists viewed_at timestamptz;
alter table public.inspections add column if not exists accepted_at timestamptz;
alter table public.inspections add column if not exists declined_at timestamptz;

create index if not exists inspections_valid_until_idx
  on public.inspections (valid_until)
  where valid_until is not null;

-- --- transition guard + timestamp stamping --------------------------------
--
-- Enforced in the DATABASE, not the route layer, because the service-role client
-- bypasses RLS: the route is not a chokepoint the way it is for anon traffic.
-- Triggers still fire for service_role, so this holds for every writer.
--
-- Terminal states: 'accepted' is final. 'declined' and 'expired' can be sent
-- back to 'drafting' to issue a revision; 'expired' can also go straight back to
-- 'sent' (a re-send, which re-stamps valid_until — see below).

create or replace function public.quote_engine_guard_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  allowed public.inspection_status[];
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  allowed := case old.status
    when 'drafting'      then array['ready_to_send']::public.inspection_status[]
    when 'ready_to_send' then array['drafting', 'sent']::public.inspection_status[]
    when 'sent'          then array['viewed', 'accepted', 'declined', 'expired']::public.inspection_status[]
    when 'viewed'        then array['accepted', 'declined', 'expired']::public.inspection_status[]
    when 'accepted'      then array[]::public.inspection_status[]
    when 'declined'      then array['drafting']::public.inspection_status[]
    when 'expired'       then array['drafting', 'sent']::public.inspection_status[]
    else array[]::public.inspection_status[]
  end;

  if not (new.status = any (allowed)) then
    raise exception
      'quote_engine: illegal status transition % -> % for inspection %',
      old.status, new.status, old.id
      using errcode = 'check_violation';
  end if;

  -- Stamp the entry timestamp for the state being entered. Only ever fills a
  -- null, so a caller that supplies an explicit timestamp (a backfill, an
  -- import) wins and a re-entry after a revision keeps the ORIGINAL first-touch
  -- time rather than resetting it.
  if new.status = 'sent' then
    new.sent_at := coalesce(new.sent_at, now());
    -- A re-send after expiry must issue a NEW window, so this one is a reset,
    -- not a coalesce — but only when the caller did not set it explicitly.
    if new.valid_until is not distinct from old.valid_until then
      new.valid_until := (current_date + 30);
    end if;
  elsif new.status = 'viewed' then
    new.viewed_at := coalesce(new.viewed_at, now());
  elsif new.status = 'accepted' then
    new.accepted_at := coalesce(new.accepted_at, now());
  elsif new.status = 'declined' then
    new.declined_at := coalesce(new.declined_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists quote_engine_inspections_guard_status on public.inspections;
create trigger quote_engine_inspections_guard_status
  before update on public.inspections
  for each row execute function public.quote_engine_guard_status();

-- --- expiry sweep ---------------------------------------------------------
--
-- Idempotent. Flips live quotes whose window has closed. NOT SCHEDULED by this
-- migration — pg_cron is not assumed to be enabled on a client project. Until a
-- caller runs it, the customer preview route still refuses to accept a quote
-- past valid_until (checked in application code), so an unswept row cannot be
-- accepted late. This function only makes the stored status agree with reality
-- for staff list views and reporting.

create or replace function public.quote_engine_expire_stale()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  update public.inspections
  set status = 'expired'
  where status in ('sent', 'viewed')
    and valid_until is not null
    and valid_until < current_date;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- Revoke from PUBLIC first, not just from anon/authenticated: every role is an
-- implicit member of PUBLIC, so revoking only the named roles would leave the
-- default PUBLIC EXECUTE in place and the sweep callable by anon. Then grant it
-- back to service_role alone, which is the only caller — the sweep is a
-- security definer that rewrites status across every tenant row.
revoke all on function public.quote_engine_expire_stale() from public, anon, authenticated;
grant execute on function public.quote_engine_expire_stale() to service_role;

comment on column public.inspections.estimate_number is
  'Customer-facing document number. Assigned at insert from quote_engine_estimate_seq; immutable thereafter. Gaps are expected (abandoned drafts consume numbers).';
comment on column public.inspections.valid_until is
  'Quote expiry date. Null while drafting; stamped on the transition into sent and then fixed. A re-send after expiry issues a new window.';
comment on column public.inspections.public_token is
  'SECRET. Sole credential for the customer-facing preview/accept route. Unguessable, unlike inspection_slug. Never log it and never serve it to the customer.';
comment on function public.quote_engine_guard_status() is
  'Owned by @waltersignal/bananaforce-module-quote-engine. Enforces legal inspection_status transitions and stamps lifecycle timestamps. Fires for service_role too, which RLS does not cover.';
comment on function public.quote_engine_expire_stale() is
  'Owned by @waltersignal/bananaforce-module-quote-engine. Idempotent sweep flipping sent/viewed quotes past valid_until to expired. Unscheduled by design; service-role invocation only.';
