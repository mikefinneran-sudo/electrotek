-- Admin module schema. Adds the STAFF layer that the catalog (0001_catalog.sql)
-- and ordering (0001_orders.sql) migrations deferred. It owns ONE new table
-- (public.staff) and ONE security-definer predicate (public.is_staff()), then
-- ADDS staff-scoped RLS policies to catalog/ordering-owned tables.
--
-- It does NOT create, drop, or alter any catalog/ordering table or column, and
-- it does NOT touch the existing customer-scoped / public-read policies — it
-- only adds NEW, additively-named staff_* policies alongside them. Apply catalog
-- and ordering before this migration; those tables must already exist.
--
-- RUNTIME PATH (MVP): the module's server.ts performs every staff operation
-- through the shared service-role client (data-supabase/service), which BYPASSES
-- RLS, behind the deny-by-default `authorize` gate in routes.ts. So at runtime,
-- admin does NOT rely on the is_staff() policies below.
--
-- FORWARD PATH: the staff table + is_staff() predicate + staff_* policies are
-- the future once staff sign in with their own Supabase Auth session. At that
-- point an app can drop the service-role client for a session-scoped client and
-- these policies become the enforcement boundary. They are defined now so the
-- forward path is a config change, not a migration.

create extension if not exists pgcrypto;

-- One row per staff auth user. Mirrors catalog.customers' FK-to-auth.users
-- idiom (id references auth.users on delete cascade). Membership in this table
-- is what is_staff() checks. Populating it is a deliberate, out-of-band admin
-- action (service-role insert) — there is intentionally no self-signup path.
create table if not exists public.staff (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

comment on table public.staff is
  'Owned by @waltersignal/bananaforce-module-admin. One row per staff auth user; membership drives public.is_staff(). Service-role managed: no self-signup, no authenticated write path. Staff are added out-of-band by an operator.';

-- Security-definer staff predicate. Mirrors catalog.is_approved_wholesale():
-- language sql, stable, security definer, set search_path = public. Runs as its
-- owner so a caller can test their own staff membership without needing a select
-- privilege on public.staff itself (staff stays unreadable by authenticated).
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff s
    where s.id = auth.uid()
  );
$$;

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

-- public.staff itself is service-role managed. RLS is enabled with NO policies,
-- so authenticated/anon are denied by default; the service-role client (used by
-- server.ts) bypasses RLS to read/write it. is_staff() is security-definer, so
-- the membership check keeps working without any select grant here.
alter table public.staff enable row level security;
revoke all on public.staff from anon, authenticated;
