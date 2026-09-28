-- Contract e-sign module schema (Wave 2). Turns an accepted quote-engine
-- inspection into a signed cleaning services agreement. Owns NEW tables only —
-- the contracts table FKs to public.inspections (owned by the quote-engine
-- module, migration 0001_quote_engine.sql). This migration does NOT add columns
-- to inspections; all contract/signature state lives in public.contracts.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'contract_status'
      and n.nspname = 'public'
  ) then
    create type public.contract_status as enum (
      'pending',
      'sent',
      'signed',
      'void'
    );
  end if;
end
$$;

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  status public.contract_status not null default 'pending',
  signer_name text,
  signer_title text,
  -- Supabase Storage object path (within the `contracts` bucket), NOT a public
  -- URL. The signature PNG and the rendered agreement PDF are stored privately
  -- and streamed through the service-role client / a signed token, never linked.
  signature_path text,
  pdf_path text,
  signed_at timestamptz,
  signed_ip text,
  signed_user_agent text,
  audit_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One active contract per inspection. A voided contract does not block issuing a
-- replacement, so the uniqueness is partial on status != 'void'.
create unique index if not exists contracts_one_active_per_inspection
  on public.contracts (inspection_id)
  where status <> 'void';

create index if not exists contracts_inspection_id_idx on public.contracts (inspection_id);
create index if not exists contracts_status_idx on public.contracts (status);

-- Keep contracts.updated_at current on every mutation (the column default only
-- covers insert). Module-scoped name so it can't clash with another module's
-- updated_at trigger.
create or replace function public.contract_esign_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists contract_esign_contracts_set_updated_at on public.contracts;
create trigger contract_esign_contracts_set_updated_at
  before update on public.contracts
  for each row execute function public.contract_esign_set_updated_at();

comment on table public.contracts is
  'Owned by @waltersignal/bananaforce-module-contract-esign. One signed cleaning services agreement per accepted inspection (FK to public.inspections). Staff/service-role managed: no anon or authenticated access. The client signs via a server-verified signed token (see src/tokens.ts); the row is read/written through the service-role client after token verification, so no public RLS policy is needed. Signature PNGs and contract PDFs live in the private `contracts` Storage bucket; signature_path/pdf_path are object paths within it.';

alter table public.contracts enable row level security;

revoke all on public.contracts from anon, authenticated;

-- contracts is staff/service-role managed. No grants and no policies for anon or
-- authenticated: with RLS enabled, every operation is denied by default. The
-- service-role key bypasses RLS, so server.ts reads and writes this table, and
-- the client-facing sign flow is gated by a server-verified signed token rather
-- than by an RLS policy. Staff-scoped read/write policies arrive with the
-- admin/crew module (Wave 2/3), keyed off a staff-auth check.

-- STORAGE (ops step — NOT created by this migration):
--   Create a PRIVATE Supabase Storage bucket named `contracts` for signed PDFs
--   and signature PNGs. Object paths used by this module:
--     contracts/<contract_id>/signature.png
--     contracts/<contract_id>/agreement.pdf
--   The bucket must NOT be public; files are streamed server-side via the
--   service-role client. server.ts degrades gracefully (warns, returns null)
--   when the bucket is absent at runtime, so this migration can land before the
--   bucket exists. Create it in the Supabase dashboard or via:
--     insert into storage.buckets (id, name, public) values ('contracts','contracts',false)
--       on conflict (id) do nothing;
--   (run as a privileged ops migration, not here, to keep this module's
--   migration limited to the tables it owns).
