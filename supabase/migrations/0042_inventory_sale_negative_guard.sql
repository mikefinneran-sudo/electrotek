-- Order fulfillment integration: allow `sale` movements to drive a location
-- negative.
--
-- When an order is fulfilled, the ordering module records `sale` movements to
-- decrement stock. Stock tracking is rarely perfect, so a fulfillment must not
-- hard-fail just because the on-hand cache is lower than what shipped. This
-- relaxes the non-negative guard for `sale` movements ONLY — counts, receipts,
-- adjustments, and transfers are still blocked from going negative. A negative
-- on-hand then surfaces as a signal in the reorder/inventory reports.

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

  if next_qty < 0 and new.movement_type <> 'sale' then
    raise exception 'Inventory movement would make stock negative'
      using errcode = '23514';
  end if;

  new.qty_after := next_qty;
  return new;
end;
$$;
