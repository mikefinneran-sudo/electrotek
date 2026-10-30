-- Lot number + expiration on the stock_movements ledger (WAL-487, first slice).
--
-- A lot is an immutable (product, lot_number, expires_on) record. Movements
-- carry an optional lot_id, set only at insert (the ledger stays append-only
-- and its triggers are unchanged). Receipts capture the lot atomically through
-- inventory_record_lot_receipt; lot-tagged adjustments write expired stock off.
-- Sales and transfers do not allocate lots yet (FEFO is a follow-up), so their
-- movements carry a null lot_id.

create table if not exists public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  product_id integer not null references public.products(id) on delete restrict,
  lot_number text not null,
  expires_on date,
  supplier_note text,
  created_at timestamptz not null default now(),
  constraint inventory_lots_lot_number_not_blank_chk
    check (length(btrim(lot_number)) > 0)
);

create unique index if not exists inventory_lots_product_lot_idx
  on public.inventory_lots (product_id, lower(btrim(lot_number)));
create index if not exists inventory_lots_expires_on_idx
  on public.inventory_lots (expires_on)
  where expires_on is not null;
-- Target for the composite FK below: a movement's lot must belong to the
-- movement's product.
create unique index if not exists inventory_lots_id_product_idx
  on public.inventory_lots (id, product_id);

alter table public.stock_movements
  add column if not exists lot_id uuid references public.inventory_lots(id) on delete restrict;

create index if not exists stock_movements_lot_id_idx
  on public.stock_movements (lot_id)
  where lot_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stock_movements_lot_product_fkey'
      and conrelid = 'public.stock_movements'::regclass
  ) then
    alter table public.stock_movements
      add constraint stock_movements_lot_product_fkey
      foreign key (lot_id, product_id)
      references public.inventory_lots (id, product_id)
      on delete restrict;
  end if;
end
$$;

comment on table public.inventory_lots is
  'Owned by @waltersignal/bananaforce-module-inventory. Immutable product lots with optional expiration; stock_movements.lot_id references them.';
comment on column public.stock_movements.lot_id is
  'Lot this movement belongs to. Set at insert only; null on sales and transfers until lot allocation ships.';

create or replace function public.inventory_record_lot_receipt(
  p_product_id integer,
  p_location_id integer,
  p_qty numeric,
  p_lot_number text,
  p_expires_on date,
  p_reference text default null,
  p_note text default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  lot_row public.inventory_lots;
  movement public.stock_movements;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Receipt qty must be greater than zero'
      using errcode = '22023';
  end if;

  if p_lot_number is null or length(btrim(p_lot_number)) = 0 then
    raise exception 'Lot number is required'
      using errcode = '22023';
  end if;

  insert into public.inventory_lots (product_id, lot_number, expires_on)
  values (p_product_id, btrim(p_lot_number), p_expires_on)
  on conflict (product_id, lower(btrim(lot_number))) do nothing
  returning * into lot_row;

  if not found then
    select *
      into lot_row
    from public.inventory_lots
    where inventory_lots.product_id = p_product_id
      and lower(btrim(inventory_lots.lot_number)) = lower(btrim(p_lot_number));

    if lot_row.expires_on is distinct from p_expires_on then
      raise exception 'Lot already exists with a different expiration'
        using errcode = '22023';
    end if;
  end if;

  insert into public.stock_movements (
    product_id,
    location_id,
    movement_type,
    qty_delta,
    lot_id,
    reference,
    note
  )
  values (
    p_product_id,
    p_location_id,
    'receipt',
    p_qty,
    lot_row.id,
    p_reference,
    p_note
  )
  returning * into movement;

  return movement;
end;
$$;

-- Service role only, like 0006: a SECURITY DEFINER mutation granted to
-- authenticated lets any logged-in customer write stock (the 0003 lesson).
-- anon/authenticated too, not only public: projects with the legacy default
-- privileges grant EXECUTE to them directly.
revoke all on function public.inventory_record_lot_receipt(integer, integer, numeric, text, date, text, text)
  from public, anon, authenticated;
grant execute on function public.inventory_record_lot_receipt(integer, integer, numeric, text, date, text, text)
  to service_role;

create or replace view public.inventory_lot_balances with (security_invoker = true) as
select
  lot.id as lot_id,
  lot.product_id,
  p.item_number,
  p.name as product_name,
  lot.lot_number,
  lot.expires_on,
  m.location_id,
  l.name as location_name,
  sum(m.qty_delta) as qty_on_hand
from public.stock_movements m
join public.inventory_lots lot on lot.id = m.lot_id
join public.products p on p.id = lot.product_id
join public.locations l on l.id = m.location_id
where m.lot_id is not null
group by lot.id, p.id, l.id, m.location_id
having sum(m.qty_delta) <> 0;

comment on view public.inventory_lot_balances is
  'Per-lot, per-location on-hand quantity. Balances only reflect movements that carry a lot_id: sales and transfers do not allocate lots yet, so a lot balance is exact only after lot-tagged adjustments reconcile it.';

alter table public.inventory_lots enable row level security;

revoke all on public.inventory_lots from anon, authenticated;
revoke all on public.inventory_lot_balances from anon, authenticated;

grant select, insert on public.inventory_lots to authenticated;
grant select on public.inventory_lot_balances to authenticated;

-- No update or delete policy: lots are immutable.
drop policy if exists "inventory_staff_reads_lots" on public.inventory_lots;
create policy "inventory_staff_reads_lots"
  on public.inventory_lots
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "inventory_staff_inserts_lots" on public.inventory_lots;
create policy "inventory_staff_inserts_lots"
  on public.inventory_lots
  for insert
  to authenticated
  with check (public.is_staff());
