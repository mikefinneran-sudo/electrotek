-- Projects module slice 6: staff can remove a client without deleting the
-- member identity retained by comments and decisions.
alter table public.project_members
  add column if not exists removed_at timestamptz null;
