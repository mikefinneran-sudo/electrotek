-- Billing write-path idempotency for quote conversion and Stripe refunds.

do $$
declare
  duplicate_count bigint;
begin
  select coalesce(sum(duplicates - 1), 0)
    into duplicate_count
  from (
    select count(*) as duplicates
    from public.invoices
    where inspection_id is not null
    group by inspection_id
    having count(*) > 1
  ) duplicate_inspections;

  if duplicate_count > 0 then
    raise exception
      'Cannot enforce one invoice per inspection: % duplicate invoice row(s) exist',
      duplicate_count;
  end if;
end
$$;

create unique index if not exists invoices_inspection_id_unique_idx
  on public.invoices (inspection_id)
  where inspection_id is not null;

drop index if exists public.invoices_inspection_id_idx;

-- PostgREST cannot target a partial unique index (42P10, measured in
-- module-quote-engine/src/line-items.ts), so the payment-intent upsert in
-- recordPayment failed on every call. A plain unique index keeps NULLs
-- distinct, so the constraint means the same thing.
create unique index if not exists payments_stripe_payment_intent_id_key
  on public.payments (stripe_payment_intent_id);

drop index if exists public.payments_stripe_payment_intent_id_idx;

alter table public.payments
  add column if not exists stripe_refund_id text;

create unique index if not exists payments_stripe_refund_id_idx
  on public.payments (stripe_refund_id);

comment on column public.payments.stripe_refund_id is
  'Stripe Refund object id. Refunds are separate negative payment rows and are idempotent on this value.';

create or replace function public.billing_create_invoice_for_inspection(
  p_inspection_id uuid,
  p_number text,
  p_amount_due numeric,
  p_currency text,
  p_status public.invoice_status,
  p_due_date date
)
returns setof public.invoices
language sql
security invoker
set search_path = ''
as $$
  insert into public.invoices (
    inspection_id,
    number,
    amount_due,
    currency,
    status,
    due_date
  )
  values (
    p_inspection_id,
    p_number,
    p_amount_due,
    p_currency,
    p_status,
    p_due_date
  )
  on conflict do nothing
  returning *;
$$;

revoke all on function public.billing_create_invoice_for_inspection(
  uuid,
  text,
  numeric,
  text,
  public.invoice_status,
  date
) from public, anon, authenticated;

grant execute on function public.billing_create_invoice_for_inspection(
  uuid,
  text,
  numeric,
  text,
  public.invoice_status,
  date
) to service_role;
