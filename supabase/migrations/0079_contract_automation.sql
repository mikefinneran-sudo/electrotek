-- Contract automation: deposit/final amounts, linked invoices, sign-invite audit.

alter table public.contracts
  add column if not exists deposit_amount_due numeric,
  add column if not exists final_amount_due numeric,
  add column if not exists deposit_invoice_id uuid,
  add column if not exists final_invoice_id uuid,
  add column if not exists sign_invite_sent_at timestamptz,
  add column if not exists deposit_invoice_sent_at timestamptz,
  add column if not exists card_fee_passthrough boolean not null default false;

comment on column public.contracts.deposit_amount_due is
  'Fixed deposit in invoice currency (USD dollars). When set, a deposit invoice is issued after signing.';
comment on column public.contracts.final_amount_due is
  'Fixed final payment in invoice currency (USD dollars). Issued manually or by a future delivery hook.';
comment on column public.contracts.deposit_invoice_id is
  'Billing module invoice id for the deposit; no FK so billing can ship independently.';
comment on column public.contracts.sign_invite_sent_at is
  'When the automated sign-invite email was sent (Resend).';
comment on column public.contracts.card_fee_passthrough is
  'Copied to the deposit invoice: card payments add 2.9% + $0.30 when the agreement says the client pays the fee.';
