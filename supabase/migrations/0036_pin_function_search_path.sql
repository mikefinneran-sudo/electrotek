-- Pin search_path on trigger functions.
--
-- Supabase advisor finding: function_search_path_mutable (WARN) x14.
--
-- A function with no explicit search_path resolves unqualified names using
-- the caller's search_path, which lets a caller shadow objects the function
-- body intended. Pinning search_path removes that ambiguity.
--
-- All 14 functions are trigger functions and were inspected before this
-- change: none contains FROM / JOIN / INSERT INTO / UPDATE / DELETE FROM, so
-- none resolves a table name at runtime. Their bodies use only now(),
-- round() and RAISE, which live in pg_catalog and resolve regardless of
-- search_path. Setting search_path to the empty string is therefore safe and
-- is the value Supabase recommends.
--
-- These are not SECURITY DEFINER, so they already ran with caller privileges;
-- this closes the name-resolution ambiguity rather than a privilege hole.

alter function public.crm_set_updated_at() set search_path = '';
alter function public.quote_engine_set_updated_at() set search_path = '';
alter function public.billing_set_updated_at() set search_path = '';
alter function public.ordering_set_updated_at() set search_path = '';
alter function public.contract_esign_set_updated_at() set search_path = '';
alter function public.scheduling_set_updated_at() set search_path = '';
alter function public.ticketing_set_updated_at() set search_path = '';
alter function public.asset_controls_set_updated_at() set search_path = '';
alter function public.communications_set_updated_at() set search_path = '';
alter function public.reporting_set_updated_at() set search_path = '';
alter function public.receptionist_set_updated_at() set search_path = '';
alter function public.inventory_touch_updated_at() set search_path = '';
alter function public.inventory_prevent_stock_movement_mutation() set search_path = '';
alter function public.enforce_order_item_total() set search_path = '';
