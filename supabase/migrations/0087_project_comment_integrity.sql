-- Projects module slice 2: comment thread integrity. The 0001 checks cover
-- author identity, internal-is-staff-only, and pin geometry; this migration
-- enforces how a comment hangs together with its project, item, version, and
-- parent, so a later client path (service role after token verify) cannot
-- attach a comment to another project's item or leak a reply to a hidden note.
-- Where a comment hangs is fixed at insert: the columns it was validated
-- against are locked on comments, items, and versions alike, so no later
-- UPDATE can strand a thread or move a pin onto a PDF.

-- Only a thread's top-level comment carries resolution.
alter table public.project_comments
  drop constraint if exists project_comments_resolve_top_level;
alter table public.project_comments
  add constraint project_comments_resolve_top_level
  check (resolved_at is null or parent_id is null);

create or replace function public.projects_validate_comment_thread()
returns trigger
language plpgsql
-- Invoker rights: staff read every row through RLS and the service role
-- bypasses it, while a non-staff caller learns nothing about hidden rows.
security invoker
set search_path = public
as $$
declare
  v_item_project uuid;
  v_version_item uuid;
  v_version_mime text;
  v_parent public.project_comments%rowtype;
begin
  if new.author_member_id is not null and not exists (
    select 1 from public.project_members member
     where member.id = new.author_member_id and member.project_id = new.project_id
  ) then
    raise exception 'comment author must be a member of the comment project';
  end if;

  if new.item_id is not null then
    select item.project_id into v_item_project
      from public.project_items item where item.id = new.item_id;
    if v_item_project is distinct from new.project_id then
      raise exception 'comment item must belong to the comment project';
    end if;
  end if;

  if new.version_id is not null then
    select version.item_id, version.mime_type into v_version_item, v_version_mime
      from public.project_item_versions version where version.id = new.version_id;
    if new.item_id is null or v_version_item is distinct from new.item_id then
      raise exception 'comment version must belong to the comment item';
    end if;
  end if;

  if new.page_no is not null and v_version_mime is distinct from 'application/pdf' then
    raise exception 'page numbers are allowed only on PDF versions';
  end if;

  if new.parent_id is not null then
    select * into v_parent from public.project_comments where id = new.parent_id;
    if v_parent.id is null
      or v_parent.parent_id is not null
      or v_parent.project_id <> new.project_id
      or v_parent.item_id is distinct from new.item_id
      or v_parent.version_id is distinct from new.version_id then
      raise exception 'replies must answer a top-level comment on the same item version';
    end if;
    if new.pin_x is not null or new.page_no is not null then
      raise exception 'replies cannot carry a pin or page number';
    end if;
    if v_parent.visibility = 'internal' and new.visibility <> 'internal' then
      raise exception 'replies to internal comments must be internal';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.projects_validate_comment_thread() from public;
revoke all on function public.projects_validate_comment_thread() from anon, authenticated;

drop trigger if exists project_comments_validate_thread on public.project_comments;
create trigger project_comments_validate_thread
  before insert or update of page_no, pin_x, pin_y
  on public.project_comments
  for each row execute function public.projects_validate_comment_thread();

create or replace function public.projects_reject_locked_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception '% cannot change after insert', tg_argv[0];
end;
$$;

revoke all on function public.projects_reject_locked_update() from public;
revoke all on function public.projects_reject_locked_update() from anon, authenticated;

drop trigger if exists project_comments_placement_locked on public.project_comments;
create trigger project_comments_placement_locked
  before update of project_id, item_id, version_id, parent_id, visibility, author_staff_id, author_member_id
  on public.project_comments
  for each row
  when ((new.project_id, new.item_id, new.version_id, new.parent_id, new.visibility,
         new.author_staff_id, new.author_member_id)
        is distinct from (old.project_id, old.item_id, old.version_id, old.parent_id, old.visibility,
         old.author_staff_id, old.author_member_id))
  execute function public.projects_reject_locked_update('comment placement, visibility, and author');

drop trigger if exists project_items_project_locked on public.project_items;
create trigger project_items_project_locked
  before update of project_id on public.project_items
  for each row when (new.project_id is distinct from old.project_id)
  execute function public.projects_reject_locked_update('item project');

drop trigger if exists project_item_versions_locked on public.project_item_versions;
create trigger project_item_versions_locked
  before update of item_id, mime_type on public.project_item_versions
  for each row when (new.item_id is distinct from old.item_id or new.mime_type is distinct from old.mime_type)
  execute function public.projects_reject_locked_update('version item and mime type');
