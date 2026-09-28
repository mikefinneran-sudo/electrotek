-- CRM RPC helpers. Additive only: preserves existing table policies and service-role
-- runtime access while giving staff-session callers atomic mutation surfaces.

create or replace function public.crm_reorder_pipeline_stages(
  p_ids uuid[]
)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.crm_pipeline_stages as stage
     set sort_order = ordered.ord - 1
    from unnest(p_ids) with ordinality as ordered(id, ord)
   where stage.id = ordered.id;
$$;

create or replace function public.crm_set_primary_deal_contact(
  p_deal uuid,
  p_contact uuid,
  p_role text default null
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform 1
    from public.crm_opportunities
   where id = p_deal
     and deleted_at is null
   for update;

  if not found then
    return false;
  end if;

  update public.crm_deal_contacts
     set is_primary = false
   where deal_id = p_deal
     and contact_id <> p_contact
     and is_primary = true;

  insert into public.crm_deal_contacts (deal_id, contact_id, role, is_primary)
  values (p_deal, p_contact, p_role, true)
  on conflict (deal_id, contact_id) do update
    set role = coalesce(excluded.role, public.crm_deal_contacts.role),
        is_primary = true;

  update public.crm_opportunities
     set contact_id = p_contact
   where id = p_deal
     and deleted_at is null;

  return true;
end;
$$;

revoke all on function public.crm_reorder_pipeline_stages(uuid[]) from public;
grant execute on function public.crm_reorder_pipeline_stages(uuid[]) to authenticated;

revoke all on function public.crm_set_primary_deal_contact(uuid, uuid, text) from public;
grant execute on function public.crm_set_primary_deal_contact(uuid, uuid, text) to authenticated;
