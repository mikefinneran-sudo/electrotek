-- WAL-390: order line-total integrity (defense-in-depth).
--
-- Tier pricing is resolved server-side at add-time in the ordering module. This
-- trigger is the DB backstop: it recomputes line_total from qty * unit_price on
-- every insert/update so a direct write can't set an arbitrary total, and it
-- rejects negative inputs. It does NOT validate unit_price against the catalog
-- (tier pricing is app logic) — only the arithmetic and non-negativity.

create or replace function public.enforce_order_item_total()
returns trigger
language plpgsql
as $$
begin
  if new.qty is null or new.qty <= 0 then
    raise exception 'order_item qty must be greater than zero';
  end if;
  if new.unit_price is null or new.unit_price < 0 then
    raise exception 'order_item unit_price must be non-negative';
  end if;
  new.line_total := round(new.qty::numeric * new.unit_price, 2);
  return new;
end;
$$;

drop trigger if exists enforce_order_item_total on public.order_items;
create trigger enforce_order_item_total
  before insert or update on public.order_items
  for each row
  execute function public.enforce_order_item_total();
