-- WAL-958: 0041 revoked from PUBLIC, but Supabase's default privileges grant
-- anon and authenticated directly, so any visitor could RPC this SECURITY
-- DEFINER function with a customer id and read that customer's wholesale
-- price. Its only caller is the enforce_order_item_total trigger, which runs
-- as the owner.
revoke execute on function public.resolve_order_item_unit_price(uuid, integer) from anon, authenticated;
