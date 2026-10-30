-- Projects module slice 5: decisions now email staff, so a client link may
-- record at most 10 decisions per 10 minutes. A fixed-window counter on the
-- member row: the UPDATE row-locks the member, so parallel requests count one
-- at a time, and a refused decision rolls its increment back.
alter table public.project_members
  add column if not exists decision_window_at timestamptz null,
  add column if not exists decision_count integer not null default 0
    check (decision_count >= 0);

create or replace function public.decide_project_item(
  p_member_id uuid,
  p_item_id uuid,
  p_version_id uuid,
  p_decision text
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_kind text;
  v_count integer;
begin
  select item.kind into v_kind
    from public.project_items item
    join public.project_members member on member.project_id = item.project_id
   where item.id = p_item_id and member.id = p_member_id
     for update of item;
  if not found then
    raise exception 'item not found';
  end if;

  if v_kind = 'file' and p_version_id is distinct from (
    select version.id from public.project_item_versions version
     where version.item_id = p_item_id
     order by version.version_no desc
     limit 1
  ) then
    raise exception 'a newer version was uploaded';
  end if;

  update public.project_members
     set decision_count = case
           when decision_window_at is null or decision_window_at <= now() - interval '10 minutes' then 1
           else decision_count + 1
         end,
         decision_window_at = case
           when decision_window_at is null or decision_window_at <= now() - interval '10 minutes' then now()
           else decision_window_at
         end
   where id = p_member_id
  returning decision_count into v_count;
  if v_count > 10 then
    raise exception 'too many client decisions';
  end if;

  update public.project_items
     set review_status = p_decision, decided_by_member_id = p_member_id, decided_at = now()
   where id = p_item_id;
  return p_item_id;
end;
$$;

revoke all on function public.decide_project_item(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.decide_project_item(uuid, uuid, uuid, text) to service_role;
