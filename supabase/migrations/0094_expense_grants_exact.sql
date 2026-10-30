-- Reset the expense tables' Data API grants to exactly what module-expense
-- issues.
--
-- 0067 granted INSERT (title) and UPDATE (title, updated_at) on
-- expense_reports so that report state -- status, decision, reimbursement --
-- could change only through the transition functions. Read back on the live
-- ElectroTek project, authenticated held table-wide SELECT, INSERT, UPDATE,
-- DELETE on all five expense tables anyway: the project's default privileges
-- grant it on every new table (Cairn #2791), and a column grant only adds.
-- RLS still refused self-approval, but a submitter could write decided_by or
-- decision_note on their own open report. Revoking first makes the grants
-- below the whole of what authenticated holds, on any project.

revoke all on
  public.expenses,
  public.expense_categories,
  public.expense_receipts,
  public.expense_mileage_rates,
  public.expense_reports
from authenticated;

grant select, insert, update, delete on public.expenses to authenticated;
grant select                         on public.expense_categories to authenticated;
grant select, insert                 on public.expense_receipts to authenticated;
grant select                         on public.expense_mileage_rates to authenticated;
grant select, delete                 on public.expense_reports to authenticated;
grant insert (title)                 on public.expense_reports to authenticated;
grant update (title, updated_at)     on public.expense_reports to authenticated;
