-- Mercury Accounts Receivable jobs, linkage, and settlement timestamps.

alter table public.invoices
  add column if not exists processor text,
  add column if not exists line_items jsonb,
  add column if not exists mercury_invoice_id text,
  add column if not exists mercury_invoice_slug text,
  add column if not exists paid_at timestamptz;

create unique index if not exists invoices_mercury_invoice_id_key
  on public.invoices (mercury_invoice_id)
  where mercury_invoice_id is not null;

alter table public.invoices
  drop constraint if exists invoices_processor_check,
  add constraint invoices_processor_check
    check (processor is null or processor in ('stripe', 'mercury')),
  drop constraint if exists invoices_line_items_array_check,
  add constraint invoices_line_items_array_check
    check (line_items is null or jsonb_typeof(line_items) = 'array');

-- A Mercury invoice settles once. This makes overlapping worker posts converge on
-- one non-Stripe successful payment without restricting Stripe/refund rows.
create unique index if not exists payments_one_non_stripe_success_per_invoice
  on public.payments (invoice_id)
  where status = 'succeeded' and stripe_payment_intent_id is null;

comment on column public.invoices.mercury_invoice_id is
  'Mercury Accounts Receivable invoice id.';
comment on column public.invoices.mercury_invoice_slug is
  'Mercury public invoice slug. The API documentation does not guarantee a public URL format.';
comment on column public.invoices.paid_at is
  'When the invoice was confirmed paid by its payment processor.';
comment on column public.invoices.processor is
  'Payment processor selected for this invoice: stripe or mercury.';
comment on column public.invoices.line_items is
  'Stored invoice line items used to create the processor invoice without recomputation.';
