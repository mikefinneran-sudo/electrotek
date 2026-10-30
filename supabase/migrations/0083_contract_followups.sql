-- CRM-native unsigned-contract follow-up ledger. Delivery remains app-owned:
-- contract-esign schedules and records work without importing the CRM module.

alter table public.contracts
  add column if not exists followup_texts boolean not null default false;

comment on column public.contracts.followup_texts is
  'Per-contract opt-in for iMessage signature reminders. Email reminders are scheduled by default.';

create table if not exists public.contract_followups (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  touch smallint not null check (touch between 1 and 4),
  channel text not null check (channel in ('email', 'text')),
  due_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'sending', 'sent', 'failed', 'canceled')),
  to_address text,
  provider_id text,
  error text,
  attempts smallint not null default 0,
  -- Needed to recover an iMessage relay crash without treating sent_at as a
  -- claim timestamp. Stale jobs are recovery-only until chat.db is checked.
  sending_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (contract_id, touch, channel)
);

create index if not exists contract_followups_due_idx
  on public.contract_followups (channel, due_at)
  where status = 'scheduled';

create index if not exists contract_followups_stale_sending_idx
  on public.contract_followups (channel, sending_at)
  where status = 'sending';

comment on table public.contract_followups is
  'Idempotent email and iMessage signature-reminder ledger owned by contract-esign.';

alter table public.contract_followups enable row level security;

revoke all on public.contract_followups from anon, authenticated;
grant select on public.contract_followups to authenticated;

drop policy if exists "contract_esign_staff_reads_followups" on public.contract_followups;
create policy "contract_esign_staff_reads_followups"
  on public.contract_followups for select
  to authenticated
  using (public.is_staff());

drop policy if exists "contract_esign_staff_inserts_followups" on public.contract_followups;
drop policy if exists "contract_esign_staff_updates_followups" on public.contract_followups;
