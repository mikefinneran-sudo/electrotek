-- WAL-387: wholesale prices are only readable by authenticated approved
-- wholesale accounts. Anon can never satisfy auth.uid(), so do not grant anon
-- access to the price table or helper function.

revoke all on public.product_wholesale_prices from anon;
grant select on public.product_wholesale_prices to authenticated;

revoke execute on function public.is_approved_wholesale() from anon;
grant execute on function public.is_approved_wholesale() to authenticated;

drop policy if exists "catalog_wholesale_read_prices" on public.product_wholesale_prices;
create policy "catalog_wholesale_read_prices"
  on public.product_wholesale_prices
  for select
  to authenticated
  using (
    public.is_approved_wholesale()
    and exists (
      select 1
      from public.products p
      where p.id = product_wholesale_prices.product_id
        and p.is_active = true
    )
  );
