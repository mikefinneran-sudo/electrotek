-- Staff session privileges for existing accounting_staff_* RLS policies.

grant select, insert, update on public.ledger_sync_log to authenticated;
grant select, insert, update on public.ledger_account_map to authenticated;
grant select, insert, update on public.ledger_outbox to authenticated;
grant select, insert, update on public.ledger_entity_map to authenticated;
grant select, insert, update on public.connector_credentials to authenticated;
grant select, insert, update on public.ledger_export_settings to authenticated;
