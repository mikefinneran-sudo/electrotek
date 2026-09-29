# Migrations

Apply the central migrations in this exact order against your client's Supabase project (`supabase db push` from the repo root applies them in filename order):

- [ ] `supabase/migrations/0000_admin_foundation.sql`
- [ ] `supabase/migrations/0001_catalog.sql`
- [ ] `supabase/migrations/0002_crm.sql`
- [ ] `supabase/migrations/0003_quote_engine.sql`
- [ ] `supabase/migrations/0004_billing.sql`
- [ ] `supabase/migrations/0005_lead_capture.sql`
- [ ] `supabase/migrations/0006_ordering.sql`
- [ ] `supabase/migrations/0007_contract_esign.sql`
- [ ] `supabase/migrations/0008_visit_checkflow.sql`
- [ ] `supabase/migrations/0009_client_portal.sql`
- [ ] `supabase/migrations/0010_scheduling.sql`
- [ ] `supabase/migrations/0011_ticketing.sql`
- [ ] `supabase/migrations/0012_asset_controls.sql`
- [ ] `supabase/migrations/0013_communications.sql`
- [ ] `supabase/migrations/0014_accounting.sql`
- [ ] `supabase/migrations/0015_reporting.sql`
- [ ] `supabase/migrations/0016_admin_policies.sql`
- [ ] `supabase/migrations/0017_accounting_outbox.sql`
- [ ] `supabase/migrations/0018_accounting_map_defaults.sql`
- [ ] `supabase/migrations/0019_commerce_extensions.sql`
- [ ] `supabase/migrations/0020_admin_staff_extensions.sql`
- [ ] `supabase/migrations/0021_export_schedule.sql`
- [ ] `supabase/migrations/0022_catalog_wholesale_price_roles.sql`
- [ ] `supabase/migrations/0023_inventory_movements.sql`
- [ ] `supabase/migrations/0024_invoice_customer.sql`
- [ ] `supabase/migrations/0025_audit_log.sql`
- [ ] `supabase/migrations/0026_lead_rpc.sql`
- [ ] `supabase/migrations/0027_order_price_integrity.sql`
- [ ] `supabase/migrations/0028_generic_attributes.sql`
- [ ] `supabase/migrations/0029_cms.sql`
- [ ] `supabase/migrations/0030_cms_pages.sql`
- [ ] `supabase/migrations/0031_cms_media.sql`
- [ ] `supabase/migrations/0032_staff_session_rls_coverage.sql`
- [ ] `supabase/migrations/0033_inventory_rpc_lockdown.sql`
- [ ] `supabase/migrations/0034_receptionist.sql`
- [ ] `supabase/migrations/0035_storage_drop_public_listing.sql`
- [ ] `supabase/migrations/0036_pin_function_search_path.sql`
- [ ] `supabase/migrations/0037_quote_lifecycle_enum.sql`
- [ ] `supabase/migrations/0038_quote_lifecycle.sql`
- [ ] `supabase/migrations/0039_quote_line_items.sql`
- [ ] `supabase/migrations/0040_ticketing_email_source.sql`
- [ ] `supabase/migrations/0041_order_price_resolution.sql`
- [ ] `supabase/migrations/0042_inventory_sale_negative_guard.sql`
- [ ] `supabase/migrations/0043_crm_platform_grade.sql`
- [ ] `supabase/migrations/0044_crm_pipeline_grants.sql`
- [ ] `supabase/migrations/0045_crm_rpc.sql`
- [ ] `supabase/migrations/0046_data_api_grants.sql`
- [ ] `supabase/migrations/0047_expense.sql`
- [ ] `supabase/migrations/0048_expense_category_map.sql`
- [ ] `supabase/migrations/0050_cases.sql`
- [ ] `supabase/migrations/0051_expense_case_subject.sql`
- [ ] `supabase/migrations/0052_cases_platform_grade.sql`
- [ ] `supabase/migrations/0053_cases_closed_on_optional.sql`
- [ ] `supabase/migrations/0054_cases_title_optional.sql`
- [ ] `supabase/migrations/0055_leads_email_optional.sql`
- [ ] `supabase/migrations/0056_forensic_case.sql`
- [ ] `supabase/migrations/0060_lead_attachments.sql`
- [ ] `supabase/migrations/0061_lead_attachments_no_anon_table_insert.sql`
- [ ] `supabase/migrations/0062_revoke_anon_staff_tables_and_case_delete.sql`
- [ ] `supabase/migrations/0063_billing_write_idempotency.sql`
- [ ] `supabase/migrations/0064_accounting_outbox_claimed_at.sql`
- [ ] `supabase/migrations/0065_ordering_atomic_cart_items.sql`
- [ ] `supabase/migrations/0066_inventory_sale_allocation.sql`
- [ ] `supabase/migrations/0067_expense_reports.sql`
- [ ] `supabase/migrations/0068_expense_grants_exact.sql`

## Module migration sources (reference)

Each enabled module owns the following migration file(s). Whether the central tree above still reflects them is enforced by `pnpm check-migrations`, not asserted here — it hashes both trees on every push and fails the build on any divergence. See `supabase/README.md` for notes on specific migrations (backfilled files, enum-pair splits, function-search-path pins).

- **crm**: 0001_crm.sql, 0002_staff_session_grants.sql, 0003_crm_platform_grade.sql, 0004_staff_session_grants_v2.sql, 0005_crm_rpc.sql, 0006_pin_function_search_path.sql, 0007_cases.sql, 0008_cases_platform_grade.sql, 0009_cases_closed_on_optional.sql, 0010_cases_title_optional.sql
- **expense**: 0001_expense.sql, 0002_expense_case_subject.sql, 0003_expense_reports.sql, 0004_expense_grants_exact.sql
- **forensic-case**: 0001_forensic_case.sql
