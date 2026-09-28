-- Lock down the inventory mutation RPCs (security review follow-up).
--
-- inventory_record_count / create_transfer / receive_transfer / cancel_transfer
-- are SECURITY DEFINER (they bypass RLS) and were granted EXECUTE to
-- authenticated in 0023 — which let any logged-in CUSTOMER mutate stock by
-- calling them directly. The module only ever invokes them via the service-role
-- client, so revoke direct execute from anon + authenticated. (A future
-- session-scoped flip will re-grant to authenticated WITH an in-function
-- is_staff() guard.)

revoke execute on function public.inventory_record_count(integer, integer, numeric, uuid, text, text) from anon, authenticated;
revoke execute on function public.inventory_create_transfer(uuid, integer, integer, jsonb, text, uuid) from anon, authenticated;
revoke execute on function public.inventory_receive_transfer(uuid, uuid, text) from anon, authenticated;
revoke execute on function public.inventory_cancel_transfer(uuid, uuid, text) from anon, authenticated;
