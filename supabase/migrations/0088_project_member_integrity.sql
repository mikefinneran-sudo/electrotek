-- Projects module slice 3: client magic links. A member's link is valid only
-- while its token_version matches the row, so revoking bumps the version. These
-- rules keep that, and a member's decisions, inside the member's own project.

-- A review decision is credited to a member of the item's project.
create or replace function public.projects_validate_item_decision()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.decided_by_member_id is not null and not exists (
    select 1 from public.project_members member
     where member.id = new.decided_by_member_id and member.project_id = new.project_id
  ) then
    raise exception 'decision member must belong to the item project';
  end if;
  return new;
end;
$$;

revoke all on function public.projects_validate_item_decision() from public;
revoke all on function public.projects_validate_item_decision() from anon, authenticated;

drop trigger if exists project_items_validate_decision on public.project_items;
create trigger project_items_validate_decision
  before insert or update of decided_by_member_id on public.project_items
  for each row execute function public.projects_validate_item_decision();

-- A member never moves to another project, and a revoked link never revives:
-- token_version only rises.
drop trigger if exists project_members_project_locked on public.project_members;
create trigger project_members_project_locked
  before update of project_id on public.project_members
  for each row when (new.project_id is distinct from old.project_id)
  execute function public.projects_reject_locked_update('member project');

drop trigger if exists project_members_token_version_rises on public.project_members;
create trigger project_members_token_version_rises
  before update of token_version on public.project_members
  for each row when (new.token_version < old.token_version)
  execute function public.projects_reject_locked_update('a lowered token version');

-- A client link posts at most 30 comments per 10 minutes. The check lives here,
-- not in the app, so parallel requests cannot all pass one count: the advisory
-- lock serializes a member's inserts until the earlier one commits.
create index if not exists project_comments_author_member_idx
  on public.project_comments (author_member_id, created_at);

create or replace function public.projects_limit_member_comments()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('project_comments:' || new.author_member_id::text));
  if (
    select count(*) from public.project_comments
     where author_member_id = new.author_member_id
       and created_at > now() - interval '10 minutes'
  ) >= 30 then
    raise exception 'too many client comments';
  end if;
  return new;
end;
$$;

revoke all on function public.projects_limit_member_comments() from public;
revoke all on function public.projects_limit_member_comments() from anon, authenticated;

drop trigger if exists project_comments_member_rate_limit on public.project_comments;
create trigger project_comments_member_rate_limit
  before insert on public.project_comments
  for each row when (new.author_member_id is not null)
  execute function public.projects_limit_member_comments();
