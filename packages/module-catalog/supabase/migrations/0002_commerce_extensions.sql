-- Catalog commerce extensions mirrored from freebies-fireworks (minus Terry CSV).
-- Promos, featured products, site copy, public inquiry tables, product media.

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'promo_type' and n.nspname = 'public'
  ) then
    create type public.promo_type as enum ('bogo', 'volume');
  end if;
end
$$;

alter table public.products
  add column if not exists unit_price numeric(10,2),
  add column if not exists promo_type public.promo_type,
  add column if not exists deal_qty integer check (deal_qty is null or deal_qty > 0),
  add column if not exists deal_price numeric(10,2) check (deal_price is null or deal_price > 0),
  add column if not exists is_featured boolean not null default false,
  add column if not exists image_url text,
  add column if not exists upc text;

create table if not exists public.event_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  event_type text,
  event_date date,
  budget text,
  location text,
  message text,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

create index if not exists event_requests_created_at_idx
  on public.event_requests (created_at desc);

alter table public.event_requests enable row level security;

drop policy if exists "catalog_anon_inserts_event_requests" on public.event_requests;
create policy "catalog_anon_inserts_event_requests"
  on public.event_requests for insert
  to anon, authenticated
  with check (true);

create table if not exists public.wholesale_inquiries (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  contact_name text not null,
  email text not null,
  phone text,
  business_type text,
  tax_id text,
  resale_cert text,
  tax_exempt boolean not null default false,
  address text,
  city text,
  state text,
  zip text,
  est_volume text,
  message text,
  tax_doc_path text,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

create index if not exists wholesale_inquiries_created_at_idx
  on public.wholesale_inquiries (created_at desc);

alter table public.wholesale_inquiries enable row level security;

drop policy if exists "catalog_anon_inserts_wholesale_inquiries" on public.wholesale_inquiries;
create policy "catalog_anon_inserts_wholesale_inquiries"
  on public.wholesale_inquiries for insert
  to anon, authenticated
  with check (true);

-- Product image bucket (public read; staff write via is_staff() policies in admin migration).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

drop policy if exists "catalog_public_reads_product_images" on storage.objects;
create policy "catalog_public_reads_product_images"
  on storage.objects for select
  using (bucket_id = 'product-images');
