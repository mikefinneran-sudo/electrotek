-- Staff session RLS coverage for admin-owned operator surfaces.
-- Depends on admin 0001/0002 plus catalog and ordering tables.
--
-- The rollout helper returns a normal Supabase Auth session for real staff, so
-- authenticated needs table privileges; RLS policies below keep access limited
-- to public.is_staff()/public.is_admin().

grant select, insert, update on public.products to authenticated;
grant select, insert, update, delete on public.product_wholesale_prices to authenticated;
grant select, insert, update, delete on public.inventory to authenticated;
grant select, update on public.customers to authenticated;
grant select, update on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant select, insert, update on public.categories to authenticated;
grant select, insert, update on public.vendors to authenticated;
grant select, update on public.locations to authenticated;
grant select, update on public.event_requests to authenticated;
grant select, update on public.wholesale_inquiries to authenticated;
grant select, insert, update on public.site_content to authenticated;
grant select, insert, update, delete on public.staff to authenticated;

drop policy if exists "admin_staff_reads_categories" on public.categories;
create policy "admin_staff_reads_categories"
  on public.categories for select
  to authenticated
  using (public.is_staff());

drop policy if exists "admin_staff_inserts_categories" on public.categories;
create policy "admin_staff_inserts_categories"
  on public.categories for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "admin_staff_updates_categories" on public.categories;
create policy "admin_staff_updates_categories"
  on public.categories for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "admin_staff_reads_vendors" on public.vendors;
create policy "admin_staff_reads_vendors"
  on public.vendors for select
  to authenticated
  using (public.is_staff());

drop policy if exists "admin_staff_inserts_vendors" on public.vendors;
create policy "admin_staff_inserts_vendors"
  on public.vendors for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "admin_staff_updates_vendors" on public.vendors;
create policy "admin_staff_updates_vendors"
  on public.vendors for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "admin_staff_reads_locations" on public.locations;
create policy "admin_staff_reads_locations"
  on public.locations for select
  to authenticated
  using (public.is_staff());

drop policy if exists "admin_staff_reads_site_content" on public.site_content;
create policy "admin_staff_reads_site_content"
  on public.site_content for select
  to authenticated
  using (public.is_staff());
