-- Admin staff_* RLS policies on catalog/ordering tables (FORWARD PATH).
-- Split from 0001_admin.sql: foundation (staff + is_staff()) runs first as 0000_admin_foundation.sql;
-- these policies run LAST because they attach to catalog/ordering tables that must exist first.

-- ===========================================================================
-- Staff-scoped RLS policies on catalog/ordering tables (FORWARD PATH).
--
-- Each is additive: a distinct staff_* name, created with `drop policy if
-- exists` first so this migration is idempotent. None of these replace or alter
-- the existing customer-scoped or public-read policies. Tables already have RLS
-- enabled and `revoke all from anon, authenticated` from their owning
-- migrations; we re-issue the minimal grants required for these staff policies
-- to function once a staff session (not service-role) is used.
--
-- NOTE: at MVP runtime these grants/policies are dormant — server.ts uses the
-- service-role client. They exist so the future session-scoped path needs no
-- new migration.
--
-- Staff writes currently go through the service-role client behind the route
-- authorize gate. These is_staff() policies are the forward path and require a
-- dedicated staff DB role grant (NOT a grant to `authenticated`) before they are
-- relied on. We deliberately do NOT grant commerce-table writes to
-- `authenticated`: doing so would hand write privilege to every customer, with
-- only RLS holding the line. The policies below carry no table-level write grant
-- on purpose; wiring the forward path means granting these privileges to a
-- dedicated staff role, not to `authenticated`.
-- ===========================================================================

-- products: staff may update existing rows and insert new ones (catalog edits).

drop policy if exists "admin_staff_reads_products" on public.products;
create policy "admin_staff_reads_products"
  on public.products
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "admin_staff_updates_products" on public.products;
create policy "admin_staff_updates_products"
  on public.products
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "admin_staff_inserts_products" on public.products;
create policy "admin_staff_inserts_products"
  on public.products
  for insert
  to authenticated
  with check (public.is_staff());

-- product_wholesale_prices: staff manage wholesale $ fully (all operations).

drop policy if exists "admin_staff_all_wholesale_prices" on public.product_wholesale_prices;
create policy "admin_staff_all_wholesale_prices"
  on public.product_wholesale_prices
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- inventory: staff manage per-location quantities fully (all operations).

drop policy if exists "admin_staff_all_inventory" on public.inventory;
create policy "admin_staff_all_inventory"
  on public.inventory
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- customers: staff read all rows and update tier / approved / tax_exempt.
-- The existing catalog policies (customer reads own row, inserts own retail row)
-- are untouched; these ADD staff-wide read + update alongside them. Column-level
-- restriction (only tier/approved/tax_exempt) is enforced in server.ts's
-- writable-field allow-list; RLS here gates row access for the staff session.

drop policy if exists "admin_staff_reads_customers" on public.customers;
create policy "admin_staff_reads_customers"
  on public.customers
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "admin_staff_updates_customers" on public.customers;
create policy "admin_staff_updates_customers"
  on public.customers
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- orders: staff read all orders and advance status (update). Customers keep
-- their own-cart policies from the ordering migration.
drop policy if exists "admin_staff_reads_orders" on public.orders;
create policy "admin_staff_reads_orders"
  on public.orders
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "admin_staff_updates_orders" on public.orders;
create policy "admin_staff_updates_orders"
  on public.orders
  for update
  to authenticated
  using (public.is_staff())
  -- Constrain the target status to the staff-actionable set so a staff session
  -- can never set cart/submitted or reopen a fulfilled order.
  with check ( public.is_staff() and status in ('confirmed','fulfilled','cancelled') );

-- order_items: staff read all line items (read-only; line edits stay with the
-- owning customer's cart policies).
drop policy if exists "admin_staff_reads_order_items" on public.order_items;
create policy "admin_staff_reads_order_items"
  on public.order_items
  for select
  to authenticated
  using (public.is_staff());

-- No staff policy weakens or removes a customer-scoped policy. Catalog's public
-- read policies (active products, public locations, etc.) and ordering's
-- own-cart policies remain exactly as their migrations defined them.
