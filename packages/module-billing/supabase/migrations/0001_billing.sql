-- Billing module schema. Owns invoices and payments.
--
-- RUNTIME PATH: all reads/writes go through the service-role client in server.ts,
-- which bypasses RLS. The billing_staff_* policies below are the FORWARD PATH
-- for when staff use a session-scoped Supabase client (keyed off is_staff()).
--
-- TABLES OWNED: invoices, payments.
-- DEPENDS ON:   @waltersignal/bananaforce-module-admin (public.is_staff()).
-- DOES NOT ALTER any other module's tables.

create extension if not exists pgcrypto;

-- invoice_status enum (idempotent do-block).
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'invoice_status'
      and n.nspname = 'public'
  ) then
    create type public.invoice_status as enum (
      'draft',
      'open',
      'paid',
      'void',
      'uncollectible'
    );
  end if;
end
$$;

-- payment_status enum (idempotent do-block).
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'payment_status'
      and n.nspname = 'public'
  ) then
    create type public.payment_status as enum (
      'pending',
      'succeeded',
      'failed',
      'refunded'
    );
  end if;
end
$$;

-- invoices: one row per invoice. inspection_id is a plain uuid reference (not
-- a FK) so the billing module can be deployed without the quote-engine module.
create table if not exists public.invoices (
  id               uuid primary key default gen_random_uuid(),
  inspection_id    uuid null,
  number           text not null,
  amount_due       numeric(12,2) not null default 0,
  currency         text not null default 'usd',
  status           public.invoice_status not null default 'draft',
  stripe_invoice_id text null,
  due_date         date null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.invoices is
  'Owned by @waltersignal/bananaforce-module-billing. Staff/service-role managed: no anon or authenticated access until admin module staff-scoped RLS policies are applied. All reads/writes via the service-role client in server.ts.';

create table if not exists public.payments (
  id                       uuid primary key default gen_random_uuid(),
  invoice_id               uuid not null references public.invoices(id) on delete cascade,
  amount                   numeric(12,2) not null,
  status                   public.payment_status not null default 'pending',
  stripe_payment_intent_id text null,
  paid_at                  timestamptz null,
  created_at               timestamptz not null default now()
);

comment on table public.payments is
  'Owned by @waltersignal/bananaforce-module-billing. Payment records linked to invoices. Staff/service-role managed. Webhook upserts on stripe_payment_intent_id for idempotency.';

-- Indexes.
create index if not exists invoices_status_idx
  on public.invoices (status);

create index if not exists invoices_inspection_id_idx
  on public.invoices (inspection_id);

create index if not exists payments_invoice_id_idx
  on public.payments (invoice_id);

-- Unique partial index on stripe_payment_intent_id (non-null only) — idempotent
-- webhook upsert relies on this constraint.
create unique index if not exists payments_stripe_payment_intent_id_idx
  on public.payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- Module-scoped updated_at trigger so the name can't clash with other modules.
create or replace function public.billing_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists billing_invoices_set_updated_at on public.invoices;
create trigger billing_invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.billing_set_updated_at();

-- RLS: enable and revoke all from anon + authenticated. Service-role bypasses.
alter table public.invoices enable row level security;
alter table public.payments enable row level security;

revoke all on public.invoices from anon, authenticated;
revoke all on public.payments from anon, authenticated;

-- ===========================================================================
-- Staff-scoped RLS policies (FORWARD PATH — keyed off public.is_staff()).
--
-- These policies are additive (billing_staff_*) and do NOT alter any other
-- module's policies. At MVP runtime they are dormant — server.ts uses the
-- service-role client. They exist so the session-scoped path needs no new
-- migration. None of these grant table-level write privileges to `authenticated`
-- directly; the forward path grants those to a dedicated staff role instead.
-- ===========================================================================

-- invoices: staff select, insert, update.

drop policy if exists "billing_staff_reads_invoices" on public.invoices;
create policy "billing_staff_reads_invoices"
  on public.invoices
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "billing_staff_inserts_invoices" on public.invoices;
create policy "billing_staff_inserts_invoices"
  on public.invoices
  for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "billing_staff_updates_invoices" on public.invoices;
create policy "billing_staff_updates_invoices"
  on public.invoices
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- payments: staff select, insert, update.

drop policy if exists "billing_staff_reads_payments" on public.payments;
create policy "billing_staff_reads_payments"
  on public.payments
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "billing_staff_inserts_payments" on public.payments;
create policy "billing_staff_inserts_payments"
  on public.payments
  for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "billing_staff_updates_payments" on public.payments;
create policy "billing_staff_updates_payments"
  on public.payments
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());
