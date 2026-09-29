-- Admit 'case' as an expense attribution target.
--
-- 0001_expense.sql constrained subject_type to customer | opportunity |
-- unattributed and noted that the real target entity "(case/matter) is an open
-- decision". crm 0007_cases.sql creates public.cases, so the decision has
-- landed and this widens the CHECK to match.
--
-- This is the attribution ElectroTek actually needs: scene-inspection travel is
-- a reimbursable cost billed back to a case, not overhead. Without it every
-- such expense had to be recorded as 'unattributed' or misfiled against an
-- 'opportunity', and neither can be billed.
--
-- subject_id stays a plain uuid with no foreign key, as 0001 established: the
-- column is polymorphic across three target tables, so a FK cannot express it.
-- expenses_subject_idx on (subject_type, subject_id) already covers the
-- per-case rollup, so no new index is needed.
--
-- Widening a CHECK cannot fail on existing rows -- every value that satisfied
-- the old constraint still satisfies the new one -- so no backfill is required.

alter table public.expenses
  drop constraint if exists expenses_subject_type_valid;

alter table public.expenses
  add constraint expenses_subject_type_valid
    check (
      subject_type is null
      or subject_type in ('customer', 'opportunity', 'case', 'unattributed')
    );

comment on column public.expenses.subject_type is
  'Attribution target: customer | opportunity | case | unattributed. Polymorphic against public.customers, public.crm_opportunities and public.cases, so intentionally not a foreign key.';
