-- Automatic export schedule (staff-configured). Single row per deploy.
-- Depends on: 0017_accounting_outbox.sql, 0020_admin_staff_extensions.sql

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'export_schedule'
      and n.nspname = 'public'
  ) then
    create type public.export_schedule as enum (
      'manual',
      'when_recorded',
      'daily',
      'weekly'
    );
  end if;
end
$$;

create table if not exists public.ledger_export_settings (
  id text primary key default 'default',
  schedule public.export_schedule not null default 'when_recorded',
  last_automatic_export_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint ledger_export_settings_singleton check (id = 'default')
);

comment on table public.ledger_export_settings is
  'Owned by @waltersignal/bananaforce-module-accounting. Staff export automation schedule.';

insert into public.ledger_export_settings (id, schedule)
values ('default', 'when_recorded')
on conflict (id) do nothing;

alter table public.ledger_export_settings enable row level security;
revoke all on public.ledger_export_settings from anon, authenticated;

drop policy if exists "accounting_staff_reads_export_settings" on public.ledger_export_settings;
create policy "accounting_staff_reads_export_settings"
  on public.ledger_export_settings for select to authenticated
  using (public.is_staff());

drop policy if exists "accounting_staff_writes_export_settings" on public.ledger_export_settings;
create policy "accounting_staff_writes_export_settings"
  on public.ledger_export_settings for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());
