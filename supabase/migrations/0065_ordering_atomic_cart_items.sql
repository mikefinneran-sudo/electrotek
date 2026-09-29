-- Atomic cart-line increments. order_items_order_product_uniq already owns
-- the (order_id, product_id) conflict target created by the base migration.

create or replace function public.ordering_add_cart_item(
  p_order_id uuid,
  p_product_id integer,
  p_qty integer
)
returns public.order_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cart_id uuid;
  item public.order_items;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Cart item quantity must be greater than zero'
      using errcode = '22023';
  end if;

  select orders.id
    into cart_id
  from public.orders
  where orders.id = p_order_id
    and orders.customer_id = auth.uid()
    and orders.status = 'cart'
  for update;

  if not found then
    raise exception 'Cart not found'
      using errcode = 'P0002';
  end if;

  insert into public.order_items (
    order_id,
    product_id,
    qty,
    unit_price,
    line_total
  )
  values (cart_id, p_product_id, p_qty, 0, 0)
  on conflict (order_id, product_id) do update
    set qty = public.order_items.qty + excluded.qty
  returning * into item;

  update public.orders
    set subtotal = (
      select coalesce(sum(order_items.line_total), 0)
      from public.order_items
      where order_items.order_id = cart_id
    )
  where orders.id = cart_id;

  return item;
end;
$$;

create or replace function public.ordering_recompute_cart_subtotal(
  p_order_id uuid
)
returns numeric
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cart_id uuid;
  total numeric(10,2);
begin
  select orders.id
    into cart_id
  from public.orders
  where orders.id = p_order_id
    and orders.customer_id = auth.uid()
    and orders.status = 'cart'
  for update;

  if not found then
    raise exception 'Cart not found'
      using errcode = 'P0002';
  end if;

  select coalesce(sum(order_items.line_total), 0)
    into total
  from public.order_items
  where order_items.order_id = cart_id;

  update public.orders
    set subtotal = total
  where orders.id = cart_id;

  return total;
end;
$$;

revoke all on function public.ordering_add_cart_item(uuid, integer, integer) from public, anon;
revoke all on function public.ordering_recompute_cart_subtotal(uuid) from public, anon;

grant execute on function public.ordering_add_cart_item(uuid, integer, integer)
  to authenticated;
grant execute on function public.ordering_recompute_cart_subtotal(uuid)
  to authenticated;
