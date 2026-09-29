-- Line items for quotes — the merge of the two quote implementations.
-- Design and rationale: docs/QUOTE-MODULE-MERGE.md
--
-- Modelled on acme-demo's public.document_line_items (0033_documents.sql),
-- which is the better data model: Square, Wave, and PayPal all price by line
-- (the WAL-531 probe evidence), while quote_addons is a flat name/price pair
-- standing in for a line grid.
--
-- quote_addons is NOT dropped. It is still read by ABC's add-on flow and by the
-- PDF's "not included" list, and dropping a table with live rows to land a new
-- model is the kind of migration that cannot be undone. Add-ons are mirrored
-- into line items by the application layer; retiring the old table is a
-- separate migration once nothing reads it.

create extension if not exists pgcrypto;

create table if not exists public.quote_line_items (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,

  -- Optional catalog link. SET NULL rather than CASCADE, copied deliberately
  -- from acme: deleting a product must not silently erase a quoted line. The
  -- snapshot columns below are what the customer agreed to, so they outlive the
  -- catalog row.
  product_id    integer null,
  sku           text null,
  description   text not null,

  quantity      numeric(12,2) not null default 1,
  unit_price    numeric(12,2) not null default 0,
  -- Generated, so a client cannot submit a line whose total disagrees with its
  -- own quantity and price.
  line_total    numeric(12,2) generated always as (round(quantity * unit_price, 2)) stored,

  -- Per-line tax rate as a percentage (7.00 = 7%). acme carries tax only at the
  -- document level; the probe set (Square, Wave) taxes per line, because a real
  -- quote mixes taxable goods with non-taxable labour.
  tax_rate      numeric(6,3) not null default 0,

  -- Where this line came from. 'generated' lines are produced from the
  -- walkthrough (sqft × rate × visits) or from a quote_addons row, and are
  -- replaced wholesale when the walkthrough changes. 'manual' lines are
  -- operator-authored and must never be clobbered by a regeneration.
  origin        text not null default 'manual'
                  check (origin in ('manual', 'generated')),
  -- For a generated line, the add-on id or synthetic key it came from, so a
  -- regeneration can match and replace rather than duplicate.
  origin_key    text null,

  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists quote_line_items_inspection_id_idx
  on public.quote_line_items (inspection_id);
create index if not exists quote_line_items_sort_idx
  on public.quote_line_items (inspection_id, sort_order);

-- One generated line per origin_key per quote: makes the regenerate path an
-- idempotent upsert instead of a delete-then-insert that loses data on failure.
create unique index if not exists quote_line_items_origin_unique_idx
  on public.quote_line_items (inspection_id, origin_key)
  where origin = 'generated' and origin_key is not null;

-- --- money on the quote ---------------------------------------------------
--
-- Recomputed server-side from the lines on every write, never accepted from a
-- client. Nullable-free with defaults so an existing quote reads as 0 rather
-- than null while it has no lines.

alter table public.inspections
  add column if not exists currency text not null default 'usd';
alter table public.inspections
  add column if not exists subtotal numeric(12,2) not null default 0;
alter table public.inspections
  add column if not exists tax numeric(12,2) not null default 0;
alter table public.inspections
  add column if not exists total numeric(12,2) not null default 0;

-- --- client snapshot ------------------------------------------------------
--
-- From acme. An issued quote must not change because someone later edited the
-- CRM record. inspections already carries prospect_* fields captured at
-- walkthrough time, so these are the CRM-linked equivalents kept separate:
-- prospect_* is what the surveyor typed, client_* is what the document says.

alter table public.inspections
  add column if not exists client_name text;
alter table public.inspections
  add column if not exists client_company text;
alter table public.inspections
  add column if not exists client_email text;

-- --- conversion lineage ---------------------------------------------------
--
-- From acme's converted_from_id, inverted. The onAccepted hook already drafts an
-- invoice, but the hook is best-effort and swallows failures; recording the link
-- in the row means the relationship survives independently of whether the hook
-- ran. No FK: module-billing owns invoices, and quote-engine must not hard-depend
-- on billing being enabled (same reason the conversion is a hook, not an import).

alter table public.inspections
  add column if not exists converted_to_invoice_id uuid;

-- --- soft delete ----------------------------------------------------------

alter table public.inspections
  add column if not exists deleted_at timestamptz;

create index if not exists inspections_deleted_at_idx
  on public.inspections (deleted_at)
  where deleted_at is null;

-- estimate_number is unique, but a soft-deleted quote should not hold its number
-- hostage. Replace the plain unique index with one that ignores deleted rows.
drop index if exists public.inspections_estimate_number_key;
create unique index if not exists inspections_estimate_number_key
  on public.inspections (estimate_number)
  where deleted_at is null;

-- --- totals recompute -----------------------------------------------------
--
-- A trigger, not application code, for the same reason the status guard is a
-- trigger: every writer goes through the RLS-bypassing service-role client, so
-- the database is the only shared chokepoint. Totals cannot drift from lines.

create or replace function public.quote_engine_recompute_totals()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  target uuid;
  v_subtotal numeric(12,2);
  v_tax numeric(12,2);
begin
  target := coalesce(new.inspection_id, old.inspection_id);

  select
    coalesce(sum(line_total), 0),
    coalesce(sum(round(line_total * tax_rate / 100.0, 2)), 0)
  into v_subtotal, v_tax
  from public.quote_line_items
  where inspection_id = target;

  update public.inspections
  set subtotal = v_subtotal,
      tax      = v_tax,
      total    = v_subtotal + v_tax
  where id = target;

  return null;
end;
$$;

drop trigger if exists quote_engine_line_items_recompute on public.quote_line_items;
create trigger quote_engine_line_items_recompute
  after insert or update or delete on public.quote_line_items
  for each row execute function public.quote_engine_recompute_totals();

-- --- security -------------------------------------------------------------
--
-- Same posture as the rest of the module: staff-scoped policies for
-- `authenticated`, nothing for anon. The customer reads line items only through
-- the token-gated route, which goes via the service-role client and returns the
-- allow-listed projection.

alter table public.quote_line_items enable row level security;
revoke all on public.quote_line_items from anon, authenticated;
grant select, insert, update, delete on public.quote_line_items to authenticated;

drop policy if exists "quote_engine_staff_reads_line_items" on public.quote_line_items;
create policy "quote_engine_staff_reads_line_items"
  on public.quote_line_items for select
  to authenticated
  using (public.is_staff());

drop policy if exists "quote_engine_staff_writes_line_items" on public.quote_line_items;
create policy "quote_engine_staff_writes_line_items"
  on public.quote_line_items for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

comment on table public.quote_line_items is
  'Owned by @waltersignal/bananaforce-module-quote-engine. Line items on a quote, modelled on acme-demo document_line_items. Snapshots sku/description/unit_price so a quote is stable when the catalog changes. origin=generated lines are derived from the walkthrough or an add-on and are replaced on regeneration; origin=manual lines are operator-authored and never clobbered. Staff/service-role managed; no anon access.';
comment on column public.inspections.converted_to_invoice_id is
  'The invoice drafted when this quote was accepted. No FK — module-billing owns invoices and quote-engine must work with billing disabled.';
comment on function public.quote_engine_recompute_totals() is
  'Owned by @waltersignal/bananaforce-module-quote-engine. Recomputes inspections subtotal/tax/total from quote_line_items. A trigger because service_role bypasses RLS, so the DB is the only chokepoint every writer shares.';
