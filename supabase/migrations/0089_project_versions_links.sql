-- Projects module slice 4: file versions after the first, and live-link items.

-- Live links render as an href on the client page, so only web URLs are stored.
alter table public.project_items drop constraint if exists project_items_url_http;
alter table public.project_items add constraint project_items_url_http
  check (url is null or url ~* '^https?://[^[:space:]]+$');

-- Adds version p_version_no to a file item after Storage has accepted the
-- object; the caller removes that object if this fails. The number must be the
-- next one, so a concurrent upload that took it first fails here (or on
-- unique (item_id, version_no)) instead of leaving a gap. A new version
-- reopens review: any decision was made on the old bytes.
create or replace function public.add_project_file_version(
  p_project_id uuid,
  p_item_id uuid,
  p_version_no integer,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_version_id uuid;
begin
  if not public.is_staff() then
    raise exception 'staff access required' using errcode = '42501';
  end if;

  perform 1 from public.project_items item
    where item.id = p_item_id and item.project_id = p_project_id and item.kind = 'file'
    for update;
  if not found then
    raise exception 'versions are added only to a file item in this project';
  end if;

  if p_version_no is distinct from (
    select max(version.version_no) + 1 from public.project_item_versions version
     where version.item_id = p_item_id
  ) then
    raise exception 'another version was uploaded first';
  end if;

  insert into public.project_item_versions (
    item_id, version_no, storage_path, file_name, mime_type, size_bytes
  ) values (
    p_item_id, p_version_no, p_storage_path, p_file_name, p_mime_type, p_size_bytes
  ) returning id into v_version_id;

  update public.project_items
     set review_status = 'in_review', decided_by_member_id = null, decided_at = null
   where id = p_item_id;
  update public.projects set updated_at = now() where id = p_project_id;
  return v_version_id;
end;
$$;

revoke all on function public.add_project_file_version(
  uuid, uuid, integer, text, text, text, bigint
) from public, anon;
grant execute on function public.add_project_file_version(
  uuid, uuid, integer, text, text, text, bigint
) to authenticated;

-- A client decision names the version the client was looking at. This and
-- add_project_file_version both lock the item row, so a decision made on a
-- page opened before a new upload is refused instead of approving bytes the
-- client never saw. Only the service role calls this, after the hub route has
-- verified the member's magic link.
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

  update public.project_items
     set review_status = p_decision, decided_by_member_id = p_member_id, decided_at = now()
   where id = p_item_id;
  return p_item_id;
end;
$$;

revoke all on function public.decide_project_item(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.decide_project_item(uuid, uuid, uuid, text) to service_role;
