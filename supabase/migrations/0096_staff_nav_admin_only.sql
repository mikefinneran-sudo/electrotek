-- Only admins may write the staff sidebar layout (WAL-1078).
--
-- site_content lets any staff member insert or update any key (is_staff()).
-- The sidebar order and names live under key 'staff.nav' and apply to the
-- whole client organization, so the saveNavLayout action allows admins only.
-- Without this, a non-admin with a session could bypass that check by
-- upserting the row through the Data API. Restrictive policies AND with the
-- existing permissive ones, so every other key keeps its current rules.

create policy "admin_only_writes_staff_nav_insert" on public.site_content
  as restrictive
  for insert
  to authenticated
  with check (key <> 'staff.nav' or public.is_admin());

create policy "admin_only_writes_staff_nav_update" on public.site_content
  as restrictive
  for update
  to authenticated
  using (key <> 'staff.nav' or public.is_admin())
  with check (key <> 'staff.nav' or public.is_admin());

create policy "admin_only_deletes_staff_nav" on public.site_content
  as restrictive
  for delete
  to authenticated
  using (key <> 'staff.nav' or public.is_admin());
