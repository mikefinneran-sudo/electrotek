-- Expense reports: staff (investigator) expense tracking in the Concur shape.
--
-- 0047 captured receipts into expenses that any staff member could read and
-- change, and posted each one to the ledger the moment its author confirmed it.
-- That is receipt capture, not expense management. A corporate expense system
-- has three things 0047 lacked, and this migration adds them:
--
--   1. Ownership. Every expense belongs to the person who incurred it. Staff
--      see and edit their own; admins see everyone's so they can approve.
--   2. Reports. Expenses are grouped into a report, submitted, approved or
--      rejected by an approver who is not the submitter, then marked reimbursed.
--      A submitted or approved report locks its expenses.
--   3. Mileage. Priced per mile at the IRS rate in force on the trip date. The
--      2026 rate changed mid-year, so the rate is date-effective, not a constant.
--
-- State transitions go through security-definer functions, and the columns
-- that carry state are not granted to authenticated. A plain UPDATE therefore
-- cannot approve a report, including the submitter's own.

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------

alter table public.expense_categories
  add column if not exists sort_order int not null default 100,
  add column if not exists active boolean not null default true,
  -- A per-mile category is entered as miles and priced from
  -- expense_mileage_rates, never typed as a dollar amount.
  add column if not exists per_mile boolean not null default false;

insert into public.expense_categories (name, sort_order, per_mile) values
  ('Mileage',               10, true),
  ('Airfare',               20, false),
  ('Lodging',               30, false),
  ('Meals',                 40, false),
  ('Rental car',            50, false),
  ('Fuel',                  60, false),
  ('Parking',               70, false),
  ('Tolls',                 80, false),
  ('Taxi / rideshare',      90, false),
  ('Shipping',             100, false),
  ('Laboratory / testing', 110, false),
  ('Equipment rental',     120, false),
  ('Supplies',             130, false),
  ('Other',                900, false)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Mileage rates
-- ---------------------------------------------------------------------------

create table if not exists public.expense_mileage_rates (
  effective_on date primary key,
  rate         numeric(6,4) not null check (rate > 0),
  source       text not null
);

comment on table public.expense_mileage_rates is
  'Business mileage rate per mile, effective from effective_on until the next row. Add a row when the IRS publishes a new rate; do not edit history.';

insert into public.expense_mileage_rates (effective_on, rate, source) values
  ('2025-01-01', 0.7000, 'IRS Notice 2025-5'),
  ('2026-01-01', 0.7250, 'IRS Notice 2026-10'),
  ('2026-07-01', 0.7600, 'IRS mid-year increase, effective 2026-07-01')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

create table if not exists public.expense_reports (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (length(btrim(title)) > 0),
  submitted_by   uuid not null default auth.uid() references public.staff(id),
  status         text not null default 'open'
    check (status in ('open', 'submitted', 'approved', 'rejected', 'reimbursed')),
  submitted_at   timestamptz null,
  decided_at     timestamptz null,
  decided_by     uuid null references public.staff(id),
  decision_note  text null,
  reimbursed_at  timestamptz null,
  reimbursed_by  uuid null references public.staff(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint expense_reports_rejection_has_reason
    check (status <> 'rejected' or length(btrim(coalesce(decision_note, ''))) > 0)
);

create index if not exists expense_reports_owner_idx
  on public.expense_reports (submitted_by, created_at desc);
create index if not exists expense_reports_status_idx
  on public.expense_reports (status, submitted_at);

-- ---------------------------------------------------------------------------
-- Expenses: owner, report, payment method, mileage
-- ---------------------------------------------------------------------------

alter table public.expenses
  add column if not exists submitted_by   uuid null default auth.uid() references public.staff(id),
  add column if not exists report_id      uuid null references public.expense_reports(id) on delete set null,
  add column if not exists payment_method text not null default 'personal',
  add column if not exists city           text null,
  add column if not exists miles          numeric(8,1) null,
  add column if not exists mileage_rate   numeric(6,4) null;

-- 0047 rows predate ownership. There are none on the live project; this keeps
-- the NOT NULL below from failing on a database that has test rows.
delete from public.expenses where submitted_by is null;
alter table public.expenses alter column submitted_by set not null;

alter table public.expenses drop constraint if exists expenses_payment_method_valid;
alter table public.expenses add constraint expenses_payment_method_valid
  check (payment_method in ('personal', 'company_card'));

-- Mileage is priced, not typed: the stored total must be miles x rate.
alter table public.expenses drop constraint if exists expenses_mileage_priced;
alter table public.expenses add constraint expenses_mileage_priced check (
  (miles is null and mileage_rate is null)
  or (miles > 0 and mileage_rate > 0 and total = round(miles * mileage_rate, 2))
);

create index if not exists expenses_owner_idx on public.expenses (submitted_by, created_at desc);
create index if not exists expenses_report_idx on public.expenses (report_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Who may approve and reimburse. 'approver' is narrower than 'admin': it
-- decides expense reports and nothing else, so granting it does not also hand
-- over staff management (0020's is_admin policies).
create or replace function public.expense_is_approver()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff s
    where s.id = auth.uid() and s.role in ('admin', 'approver')
  );
$$;

comment on column public.staff.role is 'staff | approver | admin. approver decides expense reports only.';

-- True when the caller may still change expenses in this report: no report, or
-- their own report that is open or was sent back.
create or replace function public.expense_report_is_editable(p_report uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_report is null or exists (
    select 1 from public.expense_reports r
    where r.id = p_report
      and r.submitted_by = auth.uid()
      and r.status in ('open', 'rejected')
  );
$$;

-- Mileage rate in force on a date. Null before the first recorded rate.
create or replace function public.expense_mileage_rate_on(p_date date)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select rate from public.expense_mileage_rates
  where effective_on <= p_date
  order by effective_on desc
  limit 1;
$$;

-- Price mileage in the database. The caller supplies miles and the trip date;
-- the rate and total are set here, so nobody chooses their own rate and no
-- client-side float rounding can disagree with numeric round().
create or replace function public.expense_price_mileage()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.miles is null then
    new.mileage_rate := null;
    return new;
  end if;
  if new.purchased_on is null then
    raise exception 'A mileage entry needs the trip date.';
  end if;
  new.mileage_rate := public.expense_mileage_rate_on(new.purchased_on);
  if new.mileage_rate is null then
    raise exception 'No mileage rate is on file for %.', new.purchased_on;
  end if;
  new.total := round(new.miles * new.mileage_rate, 2);
  return new;
end;
$$;

drop trigger if exists expenses_price_mileage on public.expenses;
create trigger expenses_price_mileage
  before insert or update of miles, purchased_on, total, mileage_rate on public.expenses
  for each row execute function public.expense_price_mileage();

-- ---------------------------------------------------------------------------
-- Transitions
-- ---------------------------------------------------------------------------

create or replace function public.expense_report_submit(p_report uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.expense_reports;
  v_items  int;
  v_drafts int;
begin
  select * into v_report from public.expense_reports where id = p_report for update;
  if not found or v_report.submitted_by is distinct from auth.uid() or not public.is_staff() then
    raise exception 'Report not found.';
  end if;
  if v_report.status not in ('open', 'rejected') then
    raise exception 'This report is already %.', v_report.status;
  end if;

  select count(*), count(*) filter (where status = 'draft')
    into v_items, v_drafts
  from public.expenses
  where report_id = p_report and status <> 'void';

  if v_items = 0 then
    raise exception 'Add at least one expense before submitting.';
  end if;
  if v_drafts > 0 then
    raise exception '% expense(s) on this report still need review.', v_drafts;
  end if;

  update public.expense_reports
     set status = 'submitted', submitted_at = now(),
         decided_at = null, decided_by = null, decision_note = null,
         updated_at = now()
   where id = p_report;
end;
$$;

create or replace function public.expense_report_decide(
  p_report  uuid,
  p_approve boolean,
  p_note    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.expense_reports;
begin
  if not public.expense_is_approver() then
    raise exception 'Only an approver can decide expense reports.';
  end if;

  select * into v_report from public.expense_reports where id = p_report for update;
  if not found then
    raise exception 'Report not found.';
  end if;
  if v_report.status <> 'submitted' then
    raise exception 'Only a submitted report can be decided; this one is %.', v_report.status;
  end if;
  -- Segregation of duties: nobody approves their own spending.
  if v_report.submitted_by = auth.uid() then
    raise exception 'You cannot approve or reject your own report.';
  end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'Say why the report is being sent back.';
  end if;

  update public.expense_reports
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_at = now(),
         decided_by = auth.uid(),
         decision_note = nullif(btrim(coalesce(p_note, '')), ''),
         updated_at = now()
   where id = p_report;
end;
$$;

create or replace function public.expense_report_mark_reimbursed(p_report uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.expense_reports;
begin
  if not public.expense_is_approver() then
    raise exception 'Only an approver can mark a report reimbursed.';
  end if;

  select * into v_report from public.expense_reports where id = p_report for update;
  if not found then
    raise exception 'Report not found.';
  end if;
  if v_report.status <> 'approved' then
    raise exception 'Only an approved report can be reimbursed; this one is %.', v_report.status;
  end if;

  update public.expense_reports
     set status = 'reimbursed', reimbursed_at = now(), reimbursed_by = auth.uid(),
         updated_at = now()
   where id = p_report;
end;
$$;

-- Draft expense and its receipt in one transaction. Replaces two separate
-- inserts whose best-effort compensating delete could not cover a crash
-- between them. security invoker: RLS applies exactly as for direct inserts.
create or replace function public.expense_create_draft(
  p_draft   jsonb,
  p_receipt jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.expenses
    (status, vendor, purchased_on, total, tax, currency, field_confidence)
  values (
    'draft',
    p_draft->>'vendor',
    (p_draft->>'purchased_on')::date,
    (p_draft->>'total')::numeric,
    (p_draft->>'tax')::numeric,
    coalesce(p_draft->>'currency', 'usd'),
    p_draft->'field_confidence'
  )
  returning id into v_id;

  insert into public.expense_receipts
    (expense_id, storage_path, media_type, extracted_at, extraction_error)
  values (
    v_id,
    p_receipt->>'storage_path',
    p_receipt->>'media_type',
    (p_receipt->>'extracted_at')::timestamptz,
    p_receipt->>'extraction_error'
  );

  return v_id;
end;
$$;

revoke all on function public.expense_price_mileage() from public, anon, authenticated;
revoke all on function public.expense_is_approver() from public, anon;
revoke all on function public.expense_report_is_editable(uuid) from public, anon;
revoke all on function public.expense_mileage_rate_on(date) from public, anon;
revoke all on function public.expense_report_submit(uuid) from public, anon;
revoke all on function public.expense_report_decide(uuid, boolean, text) from public, anon;
revoke all on function public.expense_report_mark_reimbursed(uuid) from public, anon;
revoke all on function public.expense_create_draft(jsonb, jsonb) from public, anon;
grant execute on function public.expense_is_approver() to authenticated;
grant execute on function public.expense_report_is_editable(uuid) to authenticated;
grant execute on function public.expense_mileage_rate_on(date) to authenticated;
grant execute on function public.expense_report_submit(uuid) to authenticated;
grant execute on function public.expense_report_decide(uuid, boolean, text) to authenticated;
grant execute on function public.expense_report_mark_reimbursed(uuid) to authenticated;
grant execute on function public.expense_create_draft(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Grants. Column lists are the access control for report state: status,
-- decision and reimbursement columns are reachable only through the functions.
-- ---------------------------------------------------------------------------

grant select                      on public.expense_mileage_rates to authenticated;
grant select, delete              on public.expense_reports to authenticated;
grant insert (title)              on public.expense_reports to authenticated;
grant update (title, updated_at)  on public.expense_reports to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.expense_mileage_rates enable row level security;
alter table public.expense_reports       enable row level security;

drop policy if exists "expense_staff_reads_mileage_rates" on public.expense_mileage_rates;
create policy "expense_staff_reads_mileage_rates"
  on public.expense_mileage_rates for select
  to authenticated
  using (public.is_staff());

-- Reports
drop policy if exists "expense_reports_select" on public.expense_reports;
create policy "expense_reports_select"
  on public.expense_reports for select
  to authenticated
  using (public.is_staff() and (submitted_by = auth.uid() or public.expense_is_approver()));

drop policy if exists "expense_reports_insert" on public.expense_reports;
create policy "expense_reports_insert"
  on public.expense_reports for insert
  to authenticated
  with check (public.is_staff() and submitted_by = auth.uid() and status = 'open');

drop policy if exists "expense_reports_update" on public.expense_reports;
create policy "expense_reports_update"
  on public.expense_reports for update
  to authenticated
  using (submitted_by = auth.uid() and status in ('open', 'rejected'))
  with check (submitted_by = auth.uid() and status in ('open', 'rejected'));

drop policy if exists "expense_reports_delete" on public.expense_reports;
create policy "expense_reports_delete"
  on public.expense_reports for delete
  to authenticated
  using (submitted_by = auth.uid() and status = 'open');

-- Expenses: replace 0047's any-staff-any-row policy.
drop policy if exists "expense_staff_all_expenses" on public.expenses;

drop policy if exists "expenses_select" on public.expenses;
create policy "expenses_select"
  on public.expenses for select
  to authenticated
  using (public.is_staff() and (submitted_by = auth.uid() or public.expense_is_approver()));

drop policy if exists "expenses_insert" on public.expenses;
create policy "expenses_insert"
  on public.expenses for insert
  to authenticated
  with check (
    public.is_staff()
    and submitted_by = auth.uid()
    and public.expense_report_is_editable(report_id)
  );

drop policy if exists "expenses_update" on public.expenses;
create policy "expenses_update"
  on public.expenses for update
  to authenticated
  using (submitted_by = auth.uid() and public.expense_report_is_editable(report_id))
  with check (submitted_by = auth.uid() and public.expense_report_is_editable(report_id));

drop policy if exists "expenses_delete" on public.expenses;
create policy "expenses_delete"
  on public.expenses for delete
  to authenticated
  using (submitted_by = auth.uid() and public.expense_report_is_editable(report_id));

-- Receipts follow their expense.
drop policy if exists "expense_staff_all_expense_receipts" on public.expense_receipts;

drop policy if exists "expense_receipts_select" on public.expense_receipts;
create policy "expense_receipts_select"
  on public.expense_receipts for select
  to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id));

drop policy if exists "expense_receipts_insert" on public.expense_receipts;
create policy "expense_receipts_insert"
  on public.expense_receipts for insert
  to authenticated
  with check (exists (
    select 1 from public.expenses e
    where e.id = expense_id
      and e.submitted_by = auth.uid()
      and public.expense_report_is_editable(e.report_id)
  ));

-- Categories: staff read. Admins manage them through the service role.
drop policy if exists "expense_staff_all_expense_categories" on public.expense_categories;
drop policy if exists "expense_categories_select" on public.expense_categories;
create policy "expense_categories_select"
  on public.expense_categories for select
  to authenticated
  using (public.is_staff());

-- Receipt images: stored under <owner uid>/..., readable by the owner and by
-- approvers. 0047 let any staff member read every receipt in the bucket.
drop policy if exists "expense_staff_selects_expense_receipts_objects" on storage.objects;
create policy "expense_staff_selects_expense_receipts_objects"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'expense-receipts' and public.is_staff()
    and ((storage.foldername(name))[1] = auth.uid()::text or public.expense_is_approver())
  );

drop policy if exists "expense_staff_inserts_expense_receipts_objects" on storage.objects;
create policy "expense_staff_inserts_expense_receipts_objects"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'expense-receipts' and public.is_staff()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "expense_staff_updates_expense_receipts_objects" on storage.objects;
create policy "expense_staff_updates_expense_receipts_objects"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'expense-receipts' and public.is_staff()
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'expense-receipts' and public.is_staff()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "expense_staff_deletes_expense_receipts_objects" on storage.objects;
create policy "expense_staff_deletes_expense_receipts_objects"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'expense-receipts' and public.is_staff()
    and (storage.foldername(name))[1] = auth.uid()::text
  );
