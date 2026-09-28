create extension if not exists pgcrypto;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  submitted_at timestamptz not null default now(),
  status text not null default 'new' check (char_length(status) <= 50),
  source text check (source is null or char_length(source) <= 100),
  name text not null check (char_length(name) between 1 and 200),
  company text check (company is null or char_length(company) <= 200),
  email text not null check (
    char_length(email) <= 254
    and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  phone text check (phone is null or char_length(phone) <= 50),
  office text check (office is null or char_length(office) <= 300),
  notes text check (notes is null or char_length(notes) <= 5000),
  ip_hash text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.leads is
  'Owned by @waltersignal/bananaforce-module-lead-capture. Direct anon insert is allowed for the public form MVP; a security-definer RPC can harden honeypot/rate-limit enforcement later.';

alter table public.leads enable row level security;

revoke all on public.leads from anon, authenticated;
grant insert on public.leads to anon, authenticated;

drop policy if exists "lead_capture_insert" on public.leads;
create policy "lead_capture_insert"
  on public.leads
  for insert
  to anon, authenticated
  with check (true);

-- No select, update, or delete policies are defined for anon/authenticated.
-- With RLS enabled, those operations are denied by default until an admin module
-- adds staff-scoped policies or a hardened security-definer RPC path.
