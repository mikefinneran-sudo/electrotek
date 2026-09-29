-- Default ledger_account_map rows for Tiller + Wave. Idempotent inserts only.
-- Depends on: 0017_accounting_outbox.sql

insert into public.ledger_account_map (connector, internal_key, external_id, label)
values
  ('tiller', 'revenue.payment', 'Payment Revenue', 'Card / Stripe payments'),
  ('tiller', 'revenue.order', 'Order Revenue', 'Submitted wholesale/retail orders'),
  ('tiller', 'revenue.refund', 'Refunds', 'Payment reversals'),
  ('tiller', 'accounts_receivable', 'Accounts Receivable', 'Open invoices'),
  ('tiller', 'cash.stripe', 'Stripe Clearing', 'Stripe settlement account'),
  ('wave', 'revenue.payment', 'revenue.payment', 'Income — payments received'),
  ('wave', 'revenue.order', 'revenue.order', 'Income — order revenue'),
  ('wave', 'revenue.refund', 'revenue.refund', 'Refunds / adjustments'),
  ('wave', 'accounts_receivable', 'accounts_receivable', 'Open invoice AR'),
  ('wave', 'cash.stripe', 'cash.stripe', 'Stripe clearing')
on conflict (connector, internal_key) do nothing;
