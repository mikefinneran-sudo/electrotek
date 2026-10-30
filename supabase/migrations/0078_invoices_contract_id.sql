-- Link invoices to contract-esign rows for deposit/final automation, and let an
-- invoice pass the card processing fee to the client.
-- No foreign key: billing installs without contract-esign.

alter table public.invoices
  add column if not exists contract_id uuid,
  add column if not exists card_fee_passthrough boolean not null default false;

create index if not exists invoices_contract_id_idx
  on public.invoices (contract_id)
  where contract_id is not null;

comment on column public.invoices.card_fee_passthrough is
  'When true, card payments charge amount_due plus 2.9% + $0.30 (the client pays the card fee).';
