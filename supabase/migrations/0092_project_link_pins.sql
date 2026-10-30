-- Projects: clients pin comments on live-link items, not only image versions.
-- A link item has no version, so its pins hang off the item. Pin geometry is
-- relative to the embedded frame's visible area (the linked page's scroll
-- position is cross-origin and cannot be read).
create or replace function public.projects_validate_comment_pin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mime_type text;
begin
  if new.pin_x is null and new.pin_y is null then
    return new;
  end if;

  if new.version_id is null then
    if new.item_id is not null and exists (
      select 1 from public.project_items item where item.id = new.item_id and item.kind = 'link'
    ) then
      return new;
    end if;
    raise exception 'pinned comments require an image version or a live link';
  end if;

  select version.mime_type
    into v_mime_type
    from public.project_item_versions version
    where version.id = new.version_id;

  if v_mime_type is null or v_mime_type not like 'image/%' then
    raise exception 'pins are allowed only on image versions';
  end if;

  return new;
end;
$$;

revoke all on function public.projects_validate_comment_pin() from public;
