-- Optional CRM links for contract automation. No foreign keys: contract-esign
-- must remain mountable without the CRM module.

alter table public.contracts
  add column if not exists crm_account_id uuid,
  add column if not exists crm_opportunity_id uuid,
  add column if not exists crm_contact_id uuid;

comment on column public.contracts.crm_account_id is
  'Optional CRM account resolved when the agreement is uploaded; no cross-module foreign key.';
comment on column public.contracts.crm_opportunity_id is
  'Optional CRM opportunity used for contract lifecycle activities; no cross-module foreign key.';
comment on column public.contracts.crm_contact_id is
  'Optional CRM contact resolved from the signer email; no cross-module foreign key.';
