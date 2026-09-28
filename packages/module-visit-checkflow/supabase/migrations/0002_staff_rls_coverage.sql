-- Staff RLS coverage for visit checkflow operator workflows.

grant select, insert on public.checklists to authenticated;
grant select, insert on public.checklist_items to authenticated;
grant select, insert on public.visit_signoffs to authenticated;
grant select, insert on public.visit_item_completions to authenticated;
grant select, insert on public.visit_photos to authenticated;

drop policy if exists "visit_checkflow_staff_reads_checklists" on public.checklists;
create policy "visit_checkflow_staff_reads_checklists"
  on public.checklists for select
  to authenticated
  using (public.is_staff());

drop policy if exists "visit_checkflow_staff_inserts_checklists" on public.checklists;
create policy "visit_checkflow_staff_inserts_checklists"
  on public.checklists for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "visit_checkflow_staff_reads_checklist_items" on public.checklist_items;
create policy "visit_checkflow_staff_reads_checklist_items"
  on public.checklist_items for select
  to authenticated
  using (public.is_staff());

drop policy if exists "visit_checkflow_staff_inserts_checklist_items" on public.checklist_items;
create policy "visit_checkflow_staff_inserts_checklist_items"
  on public.checklist_items for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "visit_checkflow_staff_reads_signoffs" on public.visit_signoffs;
create policy "visit_checkflow_staff_reads_signoffs"
  on public.visit_signoffs for select
  to authenticated
  using (public.is_staff());

drop policy if exists "visit_checkflow_staff_inserts_signoffs" on public.visit_signoffs;
create policy "visit_checkflow_staff_inserts_signoffs"
  on public.visit_signoffs for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "visit_checkflow_staff_reads_completions" on public.visit_item_completions;
create policy "visit_checkflow_staff_reads_completions"
  on public.visit_item_completions for select
  to authenticated
  using (public.is_staff());

drop policy if exists "visit_checkflow_staff_inserts_completions" on public.visit_item_completions;
create policy "visit_checkflow_staff_inserts_completions"
  on public.visit_item_completions for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "visit_checkflow_staff_reads_photos" on public.visit_photos;
create policy "visit_checkflow_staff_reads_photos"
  on public.visit_photos for select
  to authenticated
  using (public.is_staff());

drop policy if exists "visit_checkflow_staff_inserts_photos" on public.visit_photos;
create policy "visit_checkflow_staff_inserts_photos"
  on public.visit_photos for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "visit_checkflow_staff_reads_photo_objects" on storage.objects;
create policy "visit_checkflow_staff_reads_photo_objects"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'visit-photos' and public.is_staff());

drop policy if exists "visit_checkflow_staff_inserts_photo_objects" on storage.objects;
create policy "visit_checkflow_staff_inserts_photo_objects"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'visit-photos' and public.is_staff());
