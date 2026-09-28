-- WAL-390 (Option 1): resolve order_items.unit_price server-side, closing the
-- gap left by 0002_price_integrity.sql.
--
-- 0002's enforce_order_item_total only recomputes line_total from qty *
-- unit_price and rejects negative values. It does not validate unit_price
-- against the catalog, so an authenticated customer can still write an
-- arbitrary (still non-negative) unit_price directly via the anon-key REST
-- API, bypassing the add-time tier pricing in
-- packages/module-catalog/src/pricing.ts (resolvePrice). This migration makes
-- client-supplied unit_price irrelevant: the trigger now derives it itself
-- from products / product_wholesale_prices / customers, mirroring
-- resolvePrice() exactly (retail by default; wholesale only for an approved
-- wholesale-tier customer on a non-excluded product).

create or replace function public.resolve_order_item_unit_price(
  p_customer_id uuid,
  p_product_id integer
) returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_retail numeric(10,2);
  v_wholesale_excluded boolean;
  v_tier public.customer_tier;
  v_approved boolean;
  v_wholesale numeric(10,2);
begin
  select retail_price, wholesale_excluded
    into v_retail, v_wholesale_excluded
    from public.products
    where id = p_product_id;

  if not found then
    raise exception 'order_item product_id % does not exist', p_product_id;
  end if;

  select tier, approved
    into v_tier, v_approved
    from public.customers
    where id = p_customer_id;

  -- Mirrors resolvePrice(): wholesale only for an approved wholesale-tier
  -- customer on a product that isn't wholesale-excluded, and only when a
  -- wholesale price row exists. Every other combination falls back to retail.
  if coalesce(v_tier, 'retail') in ('wholesale_taxed', 'wholesale_exempt')
     and not coalesce(v_wholesale_excluded, false)
     and coalesce(v_approved, false) then
    select wholesale_price
      into v_wholesale
      from public.product_wholesale_prices
      where product_id = p_product_id;
  end if;

  if v_wholesale is not null then
    return v_wholesale;
  end if;

  if v_retail is null then
    raise exception 'product_id % has no price configured', p_product_id;
  end if;

  return v_retail;
end;
$$;

revoke all on function public.resolve_order_item_unit_price(uuid, integer) from public;

create or replace function public.enforce_order_item_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
begin
  if new.qty is null or new.qty <= 0 then
    raise exception 'order_item qty must be greater than zero';
  end if;

  select customer_id
    into v_customer_id
    from public.orders
    where id = new.order_id;

  if not found then
    raise exception 'order_item order_id % does not exist', new.order_id;
  end if;

  -- Client-supplied unit_price is discarded entirely (WAL-390); only the
  -- server-resolved price is ever written.
  new.unit_price := public.resolve_order_item_unit_price(v_customer_id, new.product_id);
  new.line_total := round(new.qty::numeric * new.unit_price, 2);
  return new;
end;
$$;

-- Table/timing/name are unchanged from 0002 — re-declared so the trigger
-- points at the function body redefined above.
drop trigger if exists enforce_order_item_total on public.order_items;
create trigger enforce_order_item_total
  before insert or update on public.order_items
  for each row
  execute function public.enforce_order_item_total();
