-- Client portal module schema (Wave 3). A token-gated client view (no login)
-- that aggregates reads across the quote-engine (inspections), contract-esign
-- (contracts), and visit-checkflow (checklists, visit_signoffs) modules. This
-- module owns exactly ONE new table: issue_reports, the client's "report an
-- issue" submissions. It replaces ABC's Issue Reports JSON-on-inspection with a
-- proper child table. It does NOT add columns to inspections or any other
-- module's tables; it only FKs to public.inspections (owned by the quote-engine
-- module, migration 0001_quote_engine.sql).

create extension if not exists pgcrypto;

create table if not exists public.issue_reports (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 5000),
  severity text check (severity in ('low', 'normal', 'high') or severity is null),
  status text not null default 'new' check (status in ('new', 'open', 'resolved', 'closed')),
  created_at timestamptz not null default now()
);

create index if not exists issue_reports_inspection_id_idx
  on public.issue_reports (inspection_id);
create index if not exists issue_reports_created_at_idx
  on public.issue_reports (created_at desc);

comment on table public.issue_reports is
  'Owned by @waltersignal/bananaforce-module-client-portal. Client-submitted issue reports for an account (FK to public.inspections). Service-role managed: no anon or authenticated access. The client never receives a DB grant — issues are written via the token-gated client portal route (verify a signed client-portal token, then insert through the service-role client). Replaces ABC''s Issue Reports JSON-on-inspection.';

alter table public.issue_reports enable row level security;

revoke all on public.issue_reports from anon, authenticated;

-- issue_reports is service-role managed. No grants and no policies for anon or
-- authenticated: with RLS enabled, every operation is denied by default. The
-- service-role key bypasses RLS, so server.ts reads and writes this table only
-- AFTER the client-portal route has verified a signed client-portal token. The
-- client is gated by that server-verified token, never by an RLS policy or a DB
-- grant. Staff-scoped read policies (to triage issues) arrive with the
-- admin/crew module, keyed off a staff-auth check.
