-- Ordering module schema. Depends on the catalog module migration
-- (0001_catalog.sql), which owns customers, products,
-- product_wholesale_prices, locations, and the customer_tier enum. Apply
-- catalog before ordering.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'order_status'
      and n.nspname = 'public'
  ) then
    create type public.order_status as enum (
      'cart',
      'submitted',
      'confirmed',
      'fulfilled',
      'cancelled'
    );
  end if;
end
$$;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  location_id integer references public.locations(id),
  status public.order_status not null default 'cart',
  subtotal numeric(10,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id serial primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id integer not null references public.products(id),
  qty integer not null check (qty > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  line_total numeric(10,2) not null check (line_total >= 0)
);

-- One open cart per customer: keeps getOrCreateCart deterministic and prevents
-- duplicate carts under concurrent adds.
create unique index if not exists orders_one_cart_per_customer
  on public.orders (customer_id)
  where status = 'cart';

create index if not exists orders_customer_id_idx on public.orders (customer_id);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists order_items_order_id_idx on public.order_items (order_id);
create index if not exists order_items_product_id_idx on public.order_items (product_id);
-- One line per product per order, so addToOrder merges instead of duplicating.
create unique index if not exists order_items_order_product_uniq
  on public.order_items (order_id, product_id);

-- Keep orders.updated_at current on every mutation (the column default only
-- covers insert). Module-scoped name so it can't clash with other triggers.
create or replace function public.ordering_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ordering_orders_set_updated_at on public.orders;
create trigger ordering_orders_set_updated_at
  before update on public.orders
  for each row execute function public.ordering_set_updated_at();

comment on table public.orders is
  'Owned by @waltersignal/bananaforce-module-ordering. Customers may only mutate their own status = cart orders; staff/admin order management is deferred to the admin module.';
comment on table public.order_items is
  'Owned by @waltersignal/bananaforce-module-ordering. Reachable only through the owning customer''s orders via RLS.';

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

revoke all on public.orders from anon, authenticated;
revoke all on public.order_items from anon, authenticated;

-- Authenticated customers operate on their own rows; anon has no access.
grant select, insert, update, delete on public.orders to authenticated;
grant select, insert, update, delete on public.order_items to authenticated;
grant usage, select on sequence public.order_items_id_seq to authenticated;

-- Orders: a customer can read all of their own orders (cart + history)...
drop policy if exists "ordering_customer_reads_own_orders" on public.orders;
create policy "ordering_customer_reads_own_orders"
  on public.orders
  for select
  to authenticated
  using (auth.uid() = customer_id);

-- ...but may only create a cart for themselves...
drop policy if exists "ordering_customer_inserts_own_cart" on public.orders;
create policy "ordering_customer_inserts_own_cart"
  on public.orders
  for insert
  to authenticated
  with check (auth.uid() = customer_id and status = 'cart');

-- ...and may only update an order while it is still a cart, and only to a cart
-- or submitted state (the submit transition). This blocks editing or
-- re-opening a submitted/confirmed/fulfilled order from the customer client.
drop policy if exists "ordering_customer_updates_own_cart" on public.orders;
create policy "ordering_customer_updates_own_cart"
  on public.orders
  for update
  to authenticated
  using (auth.uid() = customer_id and status = 'cart')
  with check (auth.uid() = customer_id and status in ('cart', 'submitted'));

-- ...and may only delete an order while it is still a cart.
drop policy if exists "ordering_customer_deletes_own_cart" on public.orders;
create policy "ordering_customer_deletes_own_cart"
  on public.orders
  for delete
  to authenticated
  using (auth.uid() = customer_id and status = 'cart');

-- Order items are reachable only through an order the caller owns. Writes are
-- further restricted to items of the caller's cart, so submitted orders are
-- frozen for customers.
drop policy if exists "ordering_customer_reads_own_items" on public.order_items;
create policy "ordering_customer_reads_own_items"
  on public.order_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_items.order_id
        and o.customer_id = auth.uid()
    )
  );

drop policy if exists "ordering_customer_inserts_own_cart_items" on public.order_items;
create policy "ordering_customer_inserts_own_cart_items"
  on public.order_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.orders o
      where o.id = order_items.order_id
        and o.customer_id = auth.uid()
        and o.status = 'cart'
    )
  );

drop policy if exists "ordering_customer_updates_own_cart_items" on public.order_items;
create policy "ordering_customer_updates_own_cart_items"
  on public.order_items
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_items.order_id
        and o.customer_id = auth.uid()
        and o.status = 'cart'
    )
  )
  with check (
    exists (
      select 1
      from public.orders o
      where o.id = order_items.order_id
        and o.customer_id = auth.uid()
        and o.status = 'cart'
    )
  );

drop policy if exists "ordering_customer_deletes_own_cart_items" on public.order_items;
create policy "ordering_customer_deletes_own_cart_items"
  on public.order_items
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_items.order_id
        and o.customer_id = auth.uid()
        and o.status = 'cart'
    )
  );

-- No anon policies are defined on orders or order_items. Staff/admin read and
-- fulfillment policies are deferred to the admin module.
