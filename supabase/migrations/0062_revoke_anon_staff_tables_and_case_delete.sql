-- B-01: legacy client projects may retain anon grants on staff-only case and
-- expense tables. D-01: authenticated staff must soft-delete cases through the
-- service-role application path, never hard-delete them through the Data API.

revoke all privileges on table
  public.cases,
  public.case_evidence,
  public.case_claimants,
  public.case_participants,
  public.addresses,
  public.contact_methods,
  public.depositions,
  public.case_time_entries,
  public.expenses,
  public.expense_categories,
  public.expense_receipts
from anon;

revoke delete on table public.cases from authenticated;

-- Case child tables soft-delete through deleted_at (0056) and are written only
-- by the service-role client in module-forensic-case, so a Data API hard
-- delete is never legitimate. expenses keeps DELETE: module-expense deletes
-- its own row with the session client when a receipt upload fails.
revoke delete on table
  public.case_evidence,
  public.case_claimants,
  public.case_participants,
  public.addresses,
  public.contact_methods,
  public.depositions,
  public.case_time_entries
from authenticated;

-- Root cause of B-01: legacy projects still carry default privileges that
-- grant anon everything on each new table. Remove them so tables created by
-- later migrations start with no anon access. A no-op on a fresh project.
alter default privileges for role postgres in schema public
  revoke all on tables from anon;
