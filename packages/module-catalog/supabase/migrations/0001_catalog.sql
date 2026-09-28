create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'customer_tier'
      and n.nspname = 'public'
  ) then
    create type public.customer_tier as enum (
      'retail',
      'wholesale_taxed',
      'wholesale_exempt'
    );
  end if;
end
$$;

create table if not exists public.customers (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  business_name text,
  tier public.customer_tier not null default 'retail',
  tax_exempt boolean not null default false,
  resale_cert_url text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id integer primary key,
  name text not null,
  sort_order numeric not null default 0
);

create table if not exists public.vendors (
  id serial primary key,
  name text not null unique
);

create table if not exists public.locations (
  id serial primary key,
  slug text not null unique,
  name text not null,
  address text,
  city text,
  state text,
  zip text,
  phone text,
  hours text,
  lat numeric,
  lng numeric,
  is_public boolean not null default true,
  sort_order numeric not null default 0
);

create table if not exists public.products (
  id serial primary key,
  item_number integer not null unique,
  name text not null,
  category_id integer references public.categories(id),
  vendor_id integer references public.vendors(id),
  brand_number text,
  pack text,
  sold_as text,
  retail_price numeric(10,2),
  effect_type text,
  shot_count integer,
  gram_weight integer,
  wholesale_excluded boolean not null default false,
  is_active boolean not null default true,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.product_wholesale_prices (
  product_id integer primary key references public.products(id) on delete cascade,
  wholesale_price numeric(10,2) not null
);

create table if not exists public.inventory (
  id serial primary key,
  product_id integer not null references public.products(id) on delete cascade,
  location_id integer not null references public.locations(id) on delete cascade,
  qty numeric not null default 0,
  unique (product_id, location_id)
);

create index if not exists categories_sort_order_idx
  on public.categories (sort_order);
create index if not exists locations_sort_order_idx
  on public.locations (sort_order);
create index if not exists products_category_id_idx
  on public.products (category_id);
create index if not exists products_vendor_id_idx
  on public.products (vendor_id);
create index if not exists products_is_active_idx
  on public.products (is_active);
create index if not exists inventory_location_id_idx
  on public.inventory (location_id);
create index if not exists inventory_product_id_idx
  on public.inventory (product_id);

comment on table public.customers is
  'Owned by @waltersignal/bananaforce-module-catalog. One row per auth.users row; wholesale tier, approval, and tax exemption are staff/service-role managed.';
comment on table public.inventory is
  'Owned by @waltersignal/bananaforce-module-catalog. Raw quantities are restricted by RLS; public catalog reads use product_availability.';

create or replace function public.is_approved_wholesale()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.customers c
    where c.id = auth.uid()
      and c.approved = true
      and c.tier in ('wholesale_taxed', 'wholesale_exempt')
  );
$$;

-- Module-scoped name: a generic handle_new_user/on_auth_user_created would
-- clobber another module's or the project's existing signup hook.
create or replace function public.catalog_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.customers (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists catalog_on_auth_user_created on auth.users;
create trigger catalog_on_auth_user_created
  after insert on auth.users
  for each row execute function public.catalog_handle_new_user();

drop view if exists public.product_availability;
-- security_invoker = false (definer): the view runs as its owner so it can read
-- inventory (which has no public RLS select policy) to derive status, while raw
-- quantities stay unreadable. Explicit so behavior is stable across Supabase
-- project defaults. The view exposes only derived status, never qty.
create view public.product_availability with (security_invoker = false) as
select
  p.id as product_id,
  case
    when coalesce(sum(i.qty), 0) <= 0 then 'out_of_stock'
    when coalesce(sum(i.qty), 0) <= 5 then 'low_stock'
    else 'in_stock'
  end as availability
from public.products p
left join public.inventory i
  on i.product_id = p.id
  and exists (
    select 1
    from public.locations l
    where l.id = i.location_id
      and l.is_public = true
  )
where p.is_active = true
group by p.id;

comment on view public.product_availability is
  'Public derived stock status for active products. Exposes in_stock, low_stock, or out_of_stock without raw inventory quantities.';

alter table public.customers enable row level security;
alter table public.categories enable row level security;
alter table public.vendors enable row level security;
alter table public.locations enable row level security;
alter table public.products enable row level security;
alter table public.product_wholesale_prices enable row level security;
alter table public.inventory enable row level security;

revoke all on public.customers from anon, authenticated;
revoke all on public.categories from anon, authenticated;
revoke all on public.vendors from anon, authenticated;
revoke all on public.locations from anon, authenticated;
revoke all on public.products from anon, authenticated;
revoke all on public.product_wholesale_prices from anon, authenticated;
revoke all on public.inventory from anon, authenticated;
revoke all on public.product_availability from anon, authenticated;
revoke all on function public.catalog_handle_new_user() from public;
revoke all on function public.is_approved_wholesale() from public;

grant select on public.categories to anon, authenticated;
grant select on public.vendors to anon, authenticated;
grant select on public.locations to anon, authenticated;
grant select on public.products to anon, authenticated;
grant select on public.product_wholesale_prices to anon, authenticated;
grant select on public.product_availability to anon, authenticated;
grant select, insert on public.customers to authenticated;
grant execute on function public.is_approved_wholesale() to anon, authenticated;

drop policy if exists "catalog_public_read_categories" on public.categories;
create policy "catalog_public_read_categories"
  on public.categories
  for select
  to anon, authenticated
  using (true);

drop policy if exists "catalog_public_read_vendors" on public.vendors;
create policy "catalog_public_read_vendors"
  on public.vendors
  for select
  to anon, authenticated
  using (true);

drop policy if exists "catalog_public_read_public_locations" on public.locations;
create policy "catalog_public_read_public_locations"
  on public.locations
  for select
  to anon, authenticated
  using (is_public = true);

drop policy if exists "catalog_public_read_active_products" on public.products;
create policy "catalog_public_read_active_products"
  on public.products
  for select
  to anon, authenticated
  using (is_active = true);

drop policy if exists "catalog_wholesale_read_prices" on public.product_wholesale_prices;
create policy "catalog_wholesale_read_prices"
  on public.product_wholesale_prices
  for select
  to anon, authenticated
  using (
    public.is_approved_wholesale()
    and exists (
      select 1
      from public.products p
      where p.id = product_wholesale_prices.product_id
        and p.is_active = true
    )
  );

drop policy if exists "catalog_customer_reads_own_row" on public.customers;
create policy "catalog_customer_reads_own_row"
  on public.customers
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "catalog_customer_inserts_own_retail_row" on public.customers;
create policy "catalog_customer_inserts_own_retail_row"
  on public.customers
  for insert
  to authenticated
  with check (
    auth.uid() = id
    and tier = 'retail'
    and approved = false
    and tax_exempt = false
  );

-- No anon/authenticated select policy is defined on public.inventory.
-- No customer update policy is defined on public.customers; tier, approval, and
-- tax exemption remain staff/service-role managed until the admin module ships.
