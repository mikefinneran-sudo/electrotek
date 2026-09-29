-- Central audit log for high-value staff and money-flow mutations.
--
-- Runtime writes are best-effort through the service-role client. RLS is the
-- forward path for session-scoped reads: only admins may select audit entries.

create table if not exists public.audit_log (
  id bigserial primary key,
  actor_id uuid,
  actor_email text,
  action text,
  resource_type text,
  resource_id text,
  "before" jsonb,
  "after" jsonb,
  created_at timestamptz not null default now()
);

comment on table public.audit_log is
  'Central BananaFORCE audit trail for high-value staff and money-flow mutations. Service-role writes are best-effort; admin reads are gated by public.is_admin().';

create index if not exists audit_log_created_at_idx
  on public.audit_log (created_at desc);

create index if not exists audit_log_resource_idx
  on public.audit_log (resource_type, resource_id);

alter table public.audit_log enable row level security;

revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

drop policy if exists "audit_log_admin_reads" on public.audit_log;
create policy "audit_log_admin_reads"
  on public.audit_log
  for select
  to authenticated
  using (public.is_admin());
