-- Inventory movement layer. Depends on catalog (products, locations,
-- inventory) and admin foundation (staff, is_staff).

create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'movement_type'
      and n.nspname = 'public'
  ) then
    create type public.movement_type as enum (
      'receipt',
      'sale',
      'transfer_out',
      'transfer_in',
      'adjustment',
      'count'
    );
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'transfer_status'
      and n.nspname = 'public'
  ) then
    create type public.transfer_status as enum (
      'pending',
      'in_transit',
      'received',
      'cancelled'
    );
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'barcode_kind'
      and n.nspname = 'public'
  ) then
    create type public.barcode_kind as enum (
      'unit',
      'case'
    );
  end if;
end
$$;

alter table public.products
  add column if not exists upc text;

create unique index if not exists products_upc_unique_idx
  on public.products (upc)
  where upc is not null and btrim(upc) <> '';

alter table public.inventory
  add column if not exists reorder_point numeric(12,2) not null default 0,
  add column if not exists reorder_qty numeric(12,2) not null default 0;

create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  from_location_id integer not null
    constraint stock_transfers_from_location_id_fkey
    references public.locations(id) on delete restrict,
  to_location_id integer not null
    constraint stock_transfers_to_location_id_fkey
    references public.locations(id) on delete restrict,
  status public.transfer_status not null default 'pending',
  note text,
  created_by uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  received_at timestamptz,
  cancelled_at timestamptz,
  constraint stock_transfers_distinct_locations_chk
    check (from_location_id <> to_location_id)
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id integer not null references public.products(id) on delete restrict,
  location_id integer not null references public.locations(id) on delete restrict,
  movement_type public.movement_type not null,
  qty_delta numeric(12,2) not null,
  qty_after numeric(12,2) not null default 0,
  transfer_id uuid references public.stock_transfers(id) on delete restrict,
  reference text,
  note text,
  created_by uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.product_barcodes (
  id uuid primary key default gen_random_uuid(),
  product_id integer not null references public.products(id) on delete cascade,
  code text not null unique,
  kind public.barcode_kind not null default 'unit',
  pack_qty integer not null default 1 check (pack_qty > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_barcodes_code_not_blank_chk
    check (length(btrim(code)) > 0)
);

create index if not exists stock_movements_product_id_idx
  on public.stock_movements (product_id);
create index if not exists stock_movements_location_id_idx
  on public.stock_movements (location_id);
create index if not exists stock_movements_transfer_id_idx
  on public.stock_movements (transfer_id);
create index if not exists stock_movements_created_at_idx
  on public.stock_movements (created_at desc);
create index if not exists stock_transfers_status_idx
  on public.stock_transfers (status);
create index if not exists stock_transfers_locations_idx
  on public.stock_transfers (from_location_id, to_location_id);
create index if not exists product_barcodes_product_id_idx
  on public.product_barcodes (product_id);

create or replace function public.inventory_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists inventory_stock_transfers_touch_updated_at
  on public.stock_transfers;
create trigger inventory_stock_transfers_touch_updated_at
  before update on public.stock_transfers
  for each row execute function public.inventory_touch_updated_at();

drop trigger if exists inventory_product_barcodes_touch_updated_at
  on public.product_barcodes;
create trigger inventory_product_barcodes_touch_updated_at
  before update on public.product_barcodes
  for each row execute function public.inventory_touch_updated_at();

create or replace function public.inventory_apply_movement_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_qty numeric(12,2);
  next_qty numeric(12,2);
begin
  insert into public.inventory (product_id, location_id, qty)
  values (new.product_id, new.location_id, 0)
  on conflict (product_id, location_id) do nothing;

  select qty
    into current_qty
  from public.inventory
  where product_id = new.product_id
    and location_id = new.location_id
  for update;

  next_qty := coalesce(current_qty, 0) + new.qty_delta;

  if next_qty < 0 then
    raise exception 'Inventory movement would make stock negative'
      using errcode = '23514';
  end if;

  new.qty_after := next_qty;
  return new;
end;
$$;

create or replace function public.inventory_apply_movement_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.inventory
    set qty = new.qty_after
  where product_id = new.product_id
    and location_id = new.location_id;

  return new;
end;
$$;

drop trigger if exists inventory_stock_movements_before_insert
  on public.stock_movements;
create trigger inventory_stock_movements_before_insert
  before insert on public.stock_movements
  for each row execute function public.inventory_apply_movement_before();

drop trigger if exists inventory_stock_movements_after_insert
  on public.stock_movements;
create trigger inventory_stock_movements_after_insert
  after insert on public.stock_movements
  for each row execute function public.inventory_apply_movement_after();

create or replace function public.inventory_prevent_stock_movement_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Stock movements are append-only'
    using errcode = '55000';
end;
$$;

drop trigger if exists inventory_stock_movements_no_update_delete
  on public.stock_movements;
create trigger inventory_stock_movements_no_update_delete
  before update or delete on public.stock_movements
  for each row execute function public.inventory_prevent_stock_movement_mutation();

create or replace function public.inventory_record_count(
  p_product_id integer,
  p_location_id integer,
  p_counted_qty numeric,
  p_created_by uuid default null,
  p_reference text default null,
  p_note text default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  current_qty numeric(12,2);
  movement public.stock_movements;
begin
  if p_counted_qty < 0 then
    raise exception 'Counted quantity must be non-negative'
      using errcode = '22023';
  end if;

  insert into public.inventory (product_id, location_id, qty)
  values (p_product_id, p_location_id, 0)
  on conflict (product_id, location_id) do nothing;

  select qty
    into current_qty
  from public.inventory
  where product_id = p_product_id
    and location_id = p_location_id
  for update;

  insert into public.stock_movements (
    product_id,
    location_id,
    movement_type,
    qty_delta,
    reference,
    note,
    created_by
  )
  values (
    p_product_id,
    p_location_id,
    'count',
    p_counted_qty - coalesce(current_qty, 0),
    p_reference,
    p_note,
    p_created_by
  )
  returning * into movement;

  return movement;
end;
$$;

create or replace function public.inventory_create_transfer(
  p_transfer_id uuid,
  p_from_location_id integer,
  p_to_location_id integer,
  p_items jsonb,
  p_note text default null,
  p_created_by uuid default null
)
returns public.stock_transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  transfer public.stock_transfers;
  item record;
  item_count integer := 0;
begin
  if p_from_location_id = p_to_location_id then
    raise exception 'Transfer locations must be different'
      using errcode = '23514';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Transfer items must be an array'
      using errcode = '22023';
  end if;

  insert into public.stock_transfers (
    id,
    from_location_id,
    to_location_id,
    status,
    note,
    created_by
  )
  values (
    coalesce(p_transfer_id, gen_random_uuid()),
    p_from_location_id,
    p_to_location_id,
    'in_transit',
    p_note,
    p_created_by
  )
  returning * into transfer;

  for item in
    select product_id, qty
    from jsonb_to_recordset(p_items) as x(product_id integer, qty numeric)
  loop
    if item.product_id is null or item.product_id <= 0 then
      raise exception 'Transfer product_id must be positive'
        using errcode = '22023';
    end if;
    if item.qty is null or item.qty <= 0 then
      raise exception 'Transfer qty must be greater than zero'
        using errcode = '22023';
    end if;

    item_count := item_count + 1;

    insert into public.stock_movements (
      product_id,
      location_id,
      movement_type,
      qty_delta,
      transfer_id,
      reference,
      note,
      created_by
    )
    values (
      item.product_id,
      p_from_location_id,
      'transfer_out',
      -item.qty,
      transfer.id,
      'transfer:' || transfer.id::text,
      p_note,
      p_created_by
    );
  end loop;

  if item_count = 0 then
    raise exception 'Transfer requires at least one item'
      using errcode = '22023';
  end if;

  return transfer;
end;
$$;

create or replace function public.inventory_receive_transfer(
  p_transfer_id uuid,
  p_created_by uuid default null,
  p_note text default null
)
returns public.stock_transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  transfer public.stock_transfers;
  item record;
  item_count integer := 0;
begin
  select *
    into transfer
  from public.stock_transfers
  where id = p_transfer_id
  for update;

  if not found then
    raise exception 'Transfer not found'
      using errcode = 'P0002';
  end if;

  if transfer.status <> 'in_transit' then
    raise exception 'Transfer is not in transit'
      using errcode = '22023';
  end if;

  for item in
    select product_id, sum(-qty_delta) as qty
    from public.stock_movements
    where transfer_id = p_transfer_id
      and movement_type = 'transfer_out'
    group by product_id
  loop
    if item.qty <= 0 then
      raise exception 'Transfer item quantity must be positive'
        using errcode = '22023';
    end if;

    item_count := item_count + 1;

    insert into public.stock_movements (
      product_id,
      location_id,
      movement_type,
      qty_delta,
      transfer_id,
      reference,
      note,
      created_by
    )
    values (
      item.product_id,
      transfer.to_location_id,
      'transfer_in',
      item.qty,
      transfer.id,
      'transfer:' || transfer.id::text,
      p_note,
      p_created_by
    );
  end loop;

  if item_count = 0 then
    raise exception 'Transfer has no outbound movements'
      using errcode = '22023';
  end if;

  update public.stock_transfers
    set status = 'received',
        received_at = now(),
        updated_at = now()
  where id = p_transfer_id
  returning * into transfer;

  return transfer;
end;
$$;

create or replace function public.inventory_cancel_transfer(
  p_transfer_id uuid,
  p_created_by uuid default null,
  p_note text default null
)
returns public.stock_transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  transfer public.stock_transfers;
  item record;
begin
  select *
    into transfer
  from public.stock_transfers
  where id = p_transfer_id
  for update;

  if not found then
    raise exception 'Transfer not found'
      using errcode = 'P0002';
  end if;

  if transfer.status <> 'in_transit' then
    raise exception 'Transfer is not in transit'
      using errcode = '22023';
  end if;

  for item in
    select product_id, sum(-qty_delta) as qty
    from public.stock_movements
    where transfer_id = p_transfer_id
      and movement_type = 'transfer_out'
    group by product_id
  loop
    insert into public.stock_movements (
      product_id,
      location_id,
      movement_type,
      qty_delta,
      transfer_id,
      reference,
      note,
      created_by
    )
    values (
      item.product_id,
      transfer.from_location_id,
      'adjustment',
      item.qty,
      transfer.id,
      'transfer-cancel:' || transfer.id::text,
      p_note,
      p_created_by
    );
  end loop;

  update public.stock_transfers
    set status = 'cancelled',
        cancelled_at = now(),
        updated_at = now()
  where id = p_transfer_id
  returning * into transfer;

  return transfer;
end;
$$;

drop view if exists public.inventory_reorder;
create view public.inventory_reorder with (security_invoker = false) as
select
  i.product_id,
  p.item_number,
  p.name as product_name,
  p.upc,
  i.location_id,
  l.name as location_name,
  i.qty,
  i.reorder_point,
  i.reorder_qty,
  greatest(i.reorder_qty, i.reorder_point - i.qty) as suggested_qty
from public.inventory i
join public.products p on p.id = i.product_id
join public.locations l on l.id = i.location_id
where p.is_active = true
  and i.reorder_point > 0
  and i.qty <= i.reorder_point;

comment on table public.stock_movements is
  'Owned by @waltersignal/bananaforce-module-inventory. Append-only stock ledger; inventory.qty is a trigger-maintained cache derived from these movements.';
comment on table public.stock_transfers is
  'Owned by @waltersignal/bananaforce-module-inventory. Inter-location transfer headers; line quantities live in stock_movements.';
comment on table public.product_barcodes is
  'Owned by @waltersignal/bananaforce-module-inventory. Additional product scan codes, including case-pack barcodes.';
comment on view public.inventory_reorder is
  'Low-stock reorder worklist derived from inventory reorder levels and current trigger-maintained quantities.';

alter table public.stock_movements enable row level security;
alter table public.stock_transfers enable row level security;
alter table public.product_barcodes enable row level security;

revoke all on public.stock_movements from anon, authenticated;
revoke all on public.stock_transfers from anon, authenticated;
revoke all on public.product_barcodes from anon, authenticated;
revoke all on public.inventory_reorder from anon, authenticated;
revoke all on function public.inventory_touch_updated_at() from public;
revoke all on function public.inventory_apply_movement_before() from public;
revoke all on function public.inventory_apply_movement_after() from public;
revoke all on function public.inventory_prevent_stock_movement_mutation() from public;
revoke all on function public.inventory_record_count(integer, integer, numeric, uuid, text, text) from public;
revoke all on function public.inventory_create_transfer(uuid, integer, integer, jsonb, text, uuid) from public;
revoke all on function public.inventory_receive_transfer(uuid, uuid, text) from public;
revoke all on function public.inventory_cancel_transfer(uuid, uuid, text) from public;

grant select, insert on public.stock_movements to authenticated;
grant select, insert, update on public.stock_transfers to authenticated;
grant select, insert, update, delete on public.product_barcodes to authenticated;
grant execute on function public.inventory_record_count(integer, integer, numeric, uuid, text, text) to authenticated;
grant execute on function public.inventory_create_transfer(uuid, integer, integer, jsonb, text, uuid) to authenticated;
grant execute on function public.inventory_receive_transfer(uuid, uuid, text) to authenticated;
grant execute on function public.inventory_cancel_transfer(uuid, uuid, text) to authenticated;

drop policy if exists "inventory_staff_reads_movements" on public.stock_movements;
create policy "inventory_staff_reads_movements"
  on public.stock_movements
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "inventory_staff_inserts_movements" on public.stock_movements;
create policy "inventory_staff_inserts_movements"
  on public.stock_movements
  for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "inventory_staff_reads_transfers" on public.stock_transfers;
create policy "inventory_staff_reads_transfers"
  on public.stock_transfers
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "inventory_staff_inserts_transfers" on public.stock_transfers;
create policy "inventory_staff_inserts_transfers"
  on public.stock_transfers
  for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "inventory_staff_updates_transfers" on public.stock_transfers;
create policy "inventory_staff_updates_transfers"
  on public.stock_transfers
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "inventory_staff_all_barcodes" on public.product_barcodes;
create policy "inventory_staff_all_barcodes"
  on public.product_barcodes
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- Convert any pre-existing direct inventory rows into opening count movements.
-- This is guarded per product/location so re-running the migration cannot
-- double-count rows that already have ledger history.
create temp table inventory_opening_counts_to_backfill on commit drop as
select i.product_id, i.location_id, i.qty
from public.inventory i
where i.qty <> 0
  and not exists (
    select 1
    from public.stock_movements sm
    where sm.product_id = i.product_id
      and sm.location_id = i.location_id
  );

update public.inventory i
  set qty = 0
from inventory_opening_counts_to_backfill b
where b.product_id = i.product_id
  and b.location_id = i.location_id;

insert into public.stock_movements (
  product_id,
  location_id,
  movement_type,
  qty_delta,
  reference,
  note
)
select
  product_id,
  location_id,
  'count',
  qty,
  'migration:inventory-opening-count',
  'Opening count generated from pre-ledger inventory.qty'
from inventory_opening_counts_to_backfill;
