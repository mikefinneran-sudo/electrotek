-- Staff session privileges for existing crm_staff_* RLS policies.

grant select, insert, update on public.accounts to authenticated;
grant select, insert, update on public.contacts to authenticated;
grant select, insert, update on public.crm_pipeline_stages to authenticated;
grant select, insert, update on public.crm_opportunities to authenticated;
grant select, insert, update on public.crm_activities to authenticated;
grant select, insert, update on public.crm_tasks to authenticated;
