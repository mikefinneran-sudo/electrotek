-- Staff extensions: name/role, admin predicate, provisioning, inquiry staff policies.
-- Depends on 0001_admin.sql (staff + is_staff()) and catalog 0002_commerce_extensions.

alter table public.staff
  add column if not exists name text,
  add column if not exists role text not null default 'staff';

comment on column public.staff.role is 'staff | admin';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff s
    where s.id = auth.uid()
      and s.role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Staff can read the allowlist (resolve current staff row).
drop policy if exists "admin_staff_reads_staff" on public.staff;
create policy "admin_staff_reads_staff"
  on public.staff for select
  to authenticated
  using (public.is_staff());

drop policy if exists "admin_admin_inserts_staff" on public.staff;
create policy "admin_admin_inserts_staff"
  on public.staff for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "admin_admin_updates_staff" on public.staff;
create policy "admin_admin_updates_staff"
  on public.staff for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin_admin_deletes_staff" on public.staff;
create policy "admin_admin_deletes_staff"
  on public.staff for delete
  to authenticated
  using (public.is_admin());

-- Staff provisioning confirms admin-created staff users through
-- auth.admin.createUser(..., email_confirm: true). Do not auto-confirm every
-- auth.users insert, because customer self-signups must keep normal email
-- confirmation semantics.
drop trigger if exists auto_confirm_user on auth.users;
drop function if exists public.auto_confirm_email();

-- site_content staff writes
drop policy if exists "admin_staff_inserts_site_content" on public.site_content;
create policy "admin_staff_inserts_site_content"
  on public.site_content for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "admin_staff_updates_site_content" on public.site_content;
create policy "admin_staff_updates_site_content"
  on public.site_content for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- locations staff update
drop policy if exists "admin_staff_updates_locations" on public.locations;
create policy "admin_staff_updates_locations"
  on public.locations for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- inquiries staff read/update
drop policy if exists "admin_staff_reads_event_requests" on public.event_requests;
create policy "admin_staff_reads_event_requests"
  on public.event_requests for select
  to authenticated
  using (public.is_staff());

drop policy if exists "admin_staff_updates_event_requests" on public.event_requests;
create policy "admin_staff_updates_event_requests"
  on public.event_requests for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "admin_staff_reads_wholesale_inquiries" on public.wholesale_inquiries;
create policy "admin_staff_reads_wholesale_inquiries"
  on public.wholesale_inquiries for select
  to authenticated
  using (public.is_staff());

drop policy if exists "admin_staff_updates_wholesale_inquiries" on public.wholesale_inquiries;
create policy "admin_staff_updates_wholesale_inquiries"
  on public.wholesale_inquiries for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- product image storage staff write
drop policy if exists "admin_staff_uploads_product_images" on storage.objects;
create policy "admin_staff_uploads_product_images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'product-images' and public.is_staff());

drop policy if exists "admin_staff_updates_product_images" on storage.objects;
create policy "admin_staff_updates_product_images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'product-images' and public.is_staff())
  with check (bucket_id = 'product-images' and public.is_staff());

drop policy if exists "admin_staff_deletes_product_images" on storage.objects;
create policy "admin_staff_deletes_product_images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'product-images' and public.is_staff());
