-- Staff RLS coverage for quote-engine operator workflows.

grant select, insert, update on public.inspections to authenticated;
grant select, insert, update, delete on public.quote_addons to authenticated;
grant select on public.task_library to authenticated;

drop policy if exists "quote_engine_staff_reads_inspections" on public.inspections;
create policy "quote_engine_staff_reads_inspections"
  on public.inspections for select
  to authenticated
  using (public.is_staff());

drop policy if exists "quote_engine_staff_inserts_inspections" on public.inspections;
create policy "quote_engine_staff_inserts_inspections"
  on public.inspections for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "quote_engine_staff_updates_inspections" on public.inspections;
create policy "quote_engine_staff_updates_inspections"
  on public.inspections for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "quote_engine_staff_reads_addons" on public.quote_addons;
create policy "quote_engine_staff_reads_addons"
  on public.quote_addons for select
  to authenticated
  using (public.is_staff());

drop policy if exists "quote_engine_staff_inserts_addons" on public.quote_addons;
create policy "quote_engine_staff_inserts_addons"
  on public.quote_addons for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "quote_engine_staff_updates_addons" on public.quote_addons;
create policy "quote_engine_staff_updates_addons"
  on public.quote_addons for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "quote_engine_staff_deletes_addons" on public.quote_addons;
create policy "quote_engine_staff_deletes_addons"
  on public.quote_addons for delete
  to authenticated
  using (public.is_staff());

drop policy if exists "quote_engine_staff_reads_task_library" on public.task_library;
create policy "quote_engine_staff_reads_task_library"
  on public.task_library for select
  to authenticated
  using (public.is_staff());
