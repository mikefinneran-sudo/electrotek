-- Staff session privileges for existing billing_staff_* RLS policies.

grant select, insert, update on public.invoices to authenticated;
grant select, insert, update on public.payments to authenticated;
