-- Add customer scoping to billing invoices.
--
-- Additive only: nullable customer_id, FK/index, and a forward-path customer
-- SELECT policy. Existing inspection_id stays in place for service-provider
-- flows and for backward-compatible portal links.

alter table public.invoices
  add column if not exists customer_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'invoices_customer_id_fkey'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      add constraint invoices_customer_id_fkey
      foreign key (customer_id)
      references public.customers(id)
      on delete set null;
  end if;
end
$$;

create index if not exists invoices_customer_id_idx
  on public.invoices (customer_id);

alter table public.invoices enable row level security;

-- Forward path for authenticated customer sessions. The service-role runtime
-- path still bypasses RLS; this policy is scoped to the auth user's customer row.
grant select on public.invoices to authenticated;

drop policy if exists "billing_customer_reads_own_invoices" on public.invoices;
create policy "billing_customer_reads_own_invoices"
  on public.invoices
  for select
  to authenticated
  using (customer_id = auth.uid());
