-- Staff session privileges for CRM Build-1 additions and existing
-- crm_staff_* RLS policies.

grant select, insert, update on public.crm_pipelines to authenticated;
grant select, insert, update, delete on public.crm_deal_contacts to authenticated;
