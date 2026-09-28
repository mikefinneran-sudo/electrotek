-- Serialize multi-location sale allocation and make order fulfillment replays
-- idempotent. Only the first movement for each order/product carries the key;
-- the whole allocation runs in one transaction, so that row is the atomic
-- claim for all location movements that follow it.

alter table public.stock_movements
  add column if not exists sale_idempotency_key text;

create unique index if not exists stock_movements_sale_idempotency_key_idx
  on public.stock_movements (sale_idempotency_key)
  where sale_idempotency_key is not null;

comment on column public.stock_movements.sale_idempotency_key is
  'Unique order-reference/product claim on the first sale movement in one atomic allocation.';

create or replace function public.inventory_record_sale(
  p_items jsonb,
  p_location_id integer default null,
  p_reference text default null
)
returns setof public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  allocation record;
  movement public.stock_movements;
  idempotency_key text;
  first_movement boolean;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Sale items must be an array'
      using errcode = '22023';
  end if;

  if p_location_id is not null and p_location_id <= 0 then
    raise exception 'Sale location_id must be positive'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as invalid(product_id integer, qty numeric)
    where invalid.product_id is null
      or invalid.product_id <= 0
      or invalid.qty is null
      or invalid.qty <= 0
  ) then
    raise exception 'Sale items require a positive product_id and qty'
      using errcode = '22023';
  end if;

  -- Every caller locks the complete product/location set in the same order
  -- before reading quantities. Concurrent allocations therefore observe the
  -- movements committed by the prior lock holder instead of the same snapshot.
  if p_location_id is null then
    perform inventory.id
    from public.inventory
    join (
      select distinct requested.product_id
      from jsonb_to_recordset(p_items) as requested(product_id integer, qty numeric)
    ) products using (product_id)
    order by inventory.product_id, inventory.location_id
    for update of inventory;
  end if;

  for item in
    select requested.product_id, sum(requested.qty)::numeric(12,2) as qty
    from jsonb_to_recordset(p_items) as requested(product_id integer, qty numeric)
    group by requested.product_id
    order by requested.product_id
  loop
    idempotency_key := case
      when p_reference like 'order:%'
        then p_reference || ':product:' || item.product_id::text
      else null
    end;

    if p_location_id is not null then
      movement := null;
      insert into public.stock_movements (
        product_id,
        location_id,
        movement_type,
        qty_delta,
        reference,
        sale_idempotency_key
      )
      values (
        item.product_id,
        p_location_id,
        'sale',
        -item.qty,
        p_reference,
        idempotency_key
      )
      on conflict do nothing
      returning * into movement;

      if found then
        return next movement;
      end if;
      continue;
    end if;

    first_movement := true;
    for allocation in
      with ranked as (
        select
          inventory.location_id,
          greatest(inventory.qty, 0)::numeric as available,
          row_number() over (
            order by inventory.qty desc, inventory.location_id
          ) as rank,
          coalesce(
            sum(greatest(inventory.qty, 0)) over (
              order by inventory.qty desc, inventory.location_id
              rows between unbounded preceding and 1 preceding
            ),
            0
          )::numeric as available_before,
          sum(greatest(inventory.qty, 0)) over ()::numeric as total_available
        from public.inventory
        where inventory.product_id = item.product_id
      )
      select
        ranked.location_id,
        round(
          greatest(
            least(ranked.available, item.qty - ranked.available_before),
            0
          ) + case
            when ranked.rank = 1
              then greatest(item.qty - ranked.total_available, 0)
            else 0
          end,
          2
        ) as qty
      from ranked
      order by ranked.rank
    loop
      if allocation.qty <= 0 then
        continue;
      end if;

      movement := null;
      insert into public.stock_movements (
        product_id,
        location_id,
        movement_type,
        qty_delta,
        reference,
        sale_idempotency_key
      )
      values (
        item.product_id,
        allocation.location_id,
        'sale',
        -allocation.qty,
        p_reference,
        case when first_movement then idempotency_key else null end
      )
      on conflict do nothing
      returning * into movement;

      -- A conflict on the first row means another request already claimed and
      -- committed this complete order/product allocation. Skip the remainder.
      if first_movement and not found then
        exit;
      end if;

      if found then
        return next movement;
      end if;
      first_movement := false;
    end loop;
  end loop;
end;
$$;

-- anon/authenticated too, not only public: projects with the legacy default
-- privileges grant EXECUTE to them directly (the 0033/0038 lesson).
revoke all on function public.inventory_record_sale(jsonb, integer, text)
  from public, anon, authenticated;
grant execute on function public.inventory_record_sale(jsonb, integer, text)
  to service_role;
