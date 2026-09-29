-- Staff session RLS coverage added before flipping modules off service-role.
--
-- This aggregate mirrors the package-level additive migrations. It is not
-- applied automatically here; apply deliberately before switching call sites to
-- getStaffDbClient().

-- Admin/catalog/ordering operator surfaces ---------------------------------

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

-- Existing staff policies that also need authenticated table privileges ------

grant select, insert, update on public.accounts to authenticated;
grant select, insert, update on public.contacts to authenticated;
grant select, insert, update on public.crm_pipeline_stages to authenticated;
grant select, insert, update on public.crm_opportunities to authenticated;
grant select, insert, update on public.crm_activities to authenticated;
grant select, insert, update on public.crm_tasks to authenticated;

grant select, insert, update on public.invoices to authenticated;
grant select, insert, update on public.payments to authenticated;

grant select, insert, update on public.message_threads to authenticated;
grant select, insert, update on public.messages to authenticated;

grant select, insert, update, delete on public.report_saved_views to authenticated;

grant select, insert, update on public.assets to authenticated;
grant select, insert, update on public.asset_assignments to authenticated;
grant select, insert on public.asset_maintenance to authenticated;

grant select, insert, update on public.tickets to authenticated;
grant select, insert on public.ticket_replies to authenticated;

grant select, insert, update on public.ledger_sync_log to authenticated;
grant select, insert, update on public.ledger_account_map to authenticated;
grant select, insert, update on public.ledger_outbox to authenticated;
grant select, insert, update on public.ledger_entity_map to authenticated;
grant select, insert, update on public.connector_credentials to authenticated;
grant select, insert, update on public.ledger_export_settings to authenticated;

grant select, insert, update on public.content_singletons to authenticated;
grant select, insert, update, delete on public.content_pages to authenticated;
grant select, insert, update, delete on public.content_blocks to authenticated;
grant select, insert, update, delete on public.content_media to authenticated;

drop policy if exists "cms_staff_selects_content_singletons" on public.content_singletons;
create policy "cms_staff_selects_content_singletons"
  on public.content_singletons for select
  to authenticated
  using (public.is_staff());

drop policy if exists "cms_staff_selects_content_media" on public.content_media;
create policy "cms_staff_selects_content_media"
  on public.content_media for select
  to authenticated
  using (public.is_staff());

alter view public.inventory_reorder set (security_invoker = true);
grant select on public.inventory_reorder to authenticated;

-- Lead capture --------------------------------------------------------------
-- INSERT stays RPC-only (0026 hardening: submit_lead()); staff get select+update.

grant select, update on public.leads to authenticated;

drop policy if exists "lead_capture_staff_reads_leads" on public.leads;
create policy "lead_capture_staff_reads_leads"
  on public.leads for select
  to authenticated
  using (public.is_staff());

drop policy if exists "lead_capture_staff_updates_leads" on public.leads;
create policy "lead_capture_staff_updates_leads"
  on public.leads for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- Quote engine --------------------------------------------------------------

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

-- Contract e-sign -----------------------------------------------------------

grant select, insert, update on public.contracts to authenticated;

drop policy if exists "contract_esign_staff_reads_contracts" on public.contracts;
create policy "contract_esign_staff_reads_contracts"
  on public.contracts for select
  to authenticated
  using (public.is_staff());

drop policy if exists "contract_esign_staff_inserts_contracts" on public.contracts;
create policy "contract_esign_staff_inserts_contracts"
  on public.contracts for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "contract_esign_staff_updates_contracts" on public.contracts;
create policy "contract_esign_staff_updates_contracts"
  on public.contracts for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "contract_esign_staff_reads_contract_objects" on storage.objects;
create policy "contract_esign_staff_reads_contract_objects"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'contracts' and public.is_staff());

drop policy if exists "contract_esign_staff_inserts_contract_objects" on storage.objects;
create policy "contract_esign_staff_inserts_contract_objects"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'contracts' and public.is_staff());

-- Visit checkflow -----------------------------------------------------------

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

-- Client portal issue triage ------------------------------------------------

grant select, update on public.issue_reports to authenticated;

drop policy if exists "client_portal_staff_reads_issue_reports" on public.issue_reports;
create policy "client_portal_staff_reads_issue_reports"
  on public.issue_reports for select
  to authenticated
  using (public.is_staff());

drop policy if exists "client_portal_staff_updates_issue_reports" on public.issue_reports;
create policy "client_portal_staff_updates_issue_reports"
  on public.issue_reports for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- Scheduling ----------------------------------------------------------------

grant select, insert, update on public.work_orders to authenticated;
grant select, insert, update on public.scheduled_visits to authenticated;
grant select, insert, update, delete on public.crew_assignments to authenticated;

drop policy if exists "scheduling_staff_deletes_crew_assignments" on public.crew_assignments;
create policy "scheduling_staff_deletes_crew_assignments"
  on public.crew_assignments for delete
  to authenticated
  using (public.is_staff());
