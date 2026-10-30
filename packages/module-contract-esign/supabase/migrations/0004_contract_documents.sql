-- Extend contract e-sign to support staff-uploaded agreement PDFs in addition
-- to inspection-generated cleaning agreements. Uploaded source PDFs remain in
-- the private `contracts` Storage bucket and are streamed only through a
-- token-gated server route.

alter table public.contracts
  alter column inspection_id drop not null;

alter table public.contracts
  add column if not exists title text,
  add column if not exists source_pdf_path text,
  add column if not exists signer_email text,
  add column if not exists signer_address text;

-- A contract is backed by exactly one source: either an accepted inspection or
-- an uploaded PDF. Dropping first keeps this migration safe to rerun after a
-- partially completed deployment.
alter table public.contracts
  drop constraint if exists contracts_exactly_one_source;

alter table public.contracts
  add constraint contracts_exactly_one_source
  check (num_nonnulls(inspection_id, source_pdf_path) = 1);

comment on column public.contracts.source_pdf_path is
  'Private contracts-bucket object path for the original uploaded agreement PDF; never a public URL.';

