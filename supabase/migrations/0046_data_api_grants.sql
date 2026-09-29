-- WAL-581: state the Data API grants this schema has always assumed, now that
-- the platform no longer supplies them.
--
-- Supabase changed what a new project starts with. Historically, project
-- creation ran `alter default privileges in schema public grant all on tables
-- to postgres, anon, authenticated, service_role`, so every table a migration
-- created was reachable by the API roles on creation. As of 2026-05-30 that is
-- no longer the default: new projects run the inverse statement, withdrawing
-- select/insert/update/delete on tables, usage/select on sequences and execute
-- on functions from anon, authenticated and service_role for anything role
-- `postgres` creates in `public`. The local CLI applies the same statement from
-- 2.114.0 (`ApplyApiPrivileges`, apps/cli-go/internal/db/start/start.go), gated
-- on `[api] auto_expose_new_tables`, which is removed entirely on 2026-10-30.
-- Supabase shipped it as a breaking change; it is not a bug, and it is not
-- reversible by pinning tooling.
--
-- Nothing in this tree ever granted to service_role, because it never had to —
-- the module headers state the assumption outright (see
-- packages/module-admin/supabase/migrations/0001_admin.sql:12). Measured against
-- a database bootstrapped with the new default, service_role reached 0 of 63
-- relations in `public`; `select count(*) from public.staff` as service_role
-- returns "permission denied for table staff". Every service-role write path in
-- packages/data-supabase/src/service.ts was inoperative.
--
-- The grants below are not a blanket restoration of the old default. They are
-- the privileges the existing migrations already presuppose, derived by diffing
-- the complete privilege surface of two databases built from this same
-- migration set — one with the new default applied, one without — and then
-- keeping only the differences some policy, sequence default or documented
-- module contract actually requires. anon and authenticated deliberately do NOT
-- get their old blanket grants back: the per-table `revoke all ... from anon,
-- authenticated` / `grant <verbs> on <table>` pairs throughout this tree are the
-- real access-control layer, and narrowing to them is the point of the upstream
-- change.

-- 1. service_role -------------------------------------------------------------
--
-- The trusted server-side identity. It already carries rolbypassrls, is never
-- exposed to a browser, and every module is written against it having full
-- access to its own tables. Restored wholesale, and stated in module-agnostic
-- terms so it holds for whatever subset of modules a client deploy installs.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- ...and for everything created after this migration. Scoped to role `postgres`
-- because that is the role migrations run as, both under `supabase db push` and
-- in local dev, and default privileges are recorded per grantor.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;

-- 2. anon / authenticated: policies that had no grant behind them --------------
--
-- Each of these is a policy that already exists and is now unreachable, because
-- the grant layer rejects the statement before RLS is consulted. Public CMS
-- reads are the visitor-facing path of the cms and catalog modules; every one of
-- these tables carries a `*_public_reads_*` policy targeting PUBLIC, which is
-- dead without a select grant for anon.
grant select on public.site_content to anon;
grant select on public.content_pages to anon;
grant select on public.content_blocks to anon;
grant select on public.content_media to anon;
grant select on public.content_singletons to anon;

-- The two public inquiry forms. Both carry catalog_anon_inserts_* policies
-- naming anon and authenticated; both are written with a plain `.insert()` and
-- no returning clause (packages/module-admin/src/inquiry-routes.ts:66,150), so
-- insert alone is sufficient and no select grant is implied.
grant insert on public.event_requests to anon, authenticated;
grant insert on public.wholesale_inquiries to anon, authenticated;

-- 3. Sequence usage behind the insert grants that already exist ----------------
--
-- These tables key off a plain `serial` (a nextval default, not an IDENTITY
-- column, which would skip the privilege check), and authenticated already holds
-- insert on all of them. Without usage on the backing sequence the insert fails
-- on the sequence rather than the table. order_items_id_seq is absent because it
-- is already granted.
grant usage, select on sequence
  public.checklist_items_id_seq,
  public.inventory_id_seq,
  public.products_id_seq,
  public.quote_addons_id_seq,
  public.vendors_id_seq,
  public.visit_item_completions_id_seq,
  public.visit_photos_id_seq
  to authenticated;

-- 4. public.calls: a pre-existing gap, not caused by the platform change -------
--
-- receptionist_staff_reads_calls and receptionist_staff_updates_calls target
-- authenticated and gate on is_staff(), but no migration ever granted
-- authenticated anything on public.calls, so both policies are dead on a legacy
-- database too — the receptionist module's staff read/update path has never
-- worked through a session client. Fixed here because section 2 above makes
-- "every policy has a grant behind it" an asserted invariant
-- (packages/rls-tests/src/data-api-grants.spec.ts), and this is the one
-- outstanding violation of it.
grant select, update on public.calls to authenticated;
