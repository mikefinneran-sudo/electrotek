-- Expense capture: receipts in, operator-confirmed expenses out.
-- Every table carries legacy_id/source_system for the deferred FileMaker import.

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'expense_status' and n.nspname = 'public'
  ) then
    create type public.expense_status as enum ('draft', 'confirmed', 'void');
  end if;
end $$;

create table if not exists public.expense_categories (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  external_account_key text null,
  legacy_id            text null,
  source_system        text null,
  created_at           timestamptz not null default now()
);

create unique index if not exists expense_categories_name_key
  on public.expense_categories (lower(name));

create table if not exists public.expenses (
  id               uuid primary key default gen_random_uuid(),
  status           public.expense_status not null default 'draft',
  vendor           text null,
  purchased_on     date null,
  total            numeric(12,2) null,
  tax              numeric(12,2) null,
  currency         text not null default 'usd',
  category_id      uuid null references public.expense_categories(id) on delete set null,
  -- Attribution without a foreign key: the target entity (case/matter) is an
  -- open decision. Binding this to a real table later is an additive migration.
  subject_type     text null,
  subject_id       uuid null,
  note             text null,
  field_confidence jsonb null,
  confirmed_at     timestamptz null,
  confirmed_by     uuid null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  legacy_id        text null,
  source_system    text null,
  constraint expenses_subject_type_valid
    check (subject_type is null or subject_type in ('customer', 'opportunity', 'unattributed')),
  constraint expenses_total_non_negative check (total is null or total >= 0),
  constraint expenses_tax_non_negative check (tax is null or tax >= 0),
  -- A confirmed expense must be complete. This is the database half of the
  -- draft-then-confirm boundary: incomplete rows cannot reach the ledger.
  constraint expenses_confirmed_is_complete check (
    status <> 'confirmed'
    or (vendor is not null and purchased_on is not null and total is not null
        and confirmed_at is not null and confirmed_by is not null)
  )
);

create index if not exists expenses_status_idx on public.expenses (status, created_at desc);
create index if not exists expenses_subject_idx on public.expenses (subject_type, subject_id);

create table if not exists public.expense_receipts (
  id               uuid primary key default gen_random_uuid(),
  expense_id       uuid not null references public.expenses(id) on delete cascade,
  storage_path     text not null unique,
  media_type       text not null,
  extracted_at     timestamptz null,
  extraction_error text null,
  created_at       timestamptz not null default now(),
  legacy_id        text null,
  source_system    text null
);

create index if not exists expense_receipts_expense_idx
  on public.expense_receipts (expense_id);

-- Data API grants (WAL-603). Per WAL-581 (0046_data_api_grants.sql) a project
-- created after 2026-05-30 grants the API roles nothing on a table a migration
-- creates, and 0046 deliberately does not restore a blanket grant for anon or
-- authenticated — the per-table pairs below are the access-control layer. The
-- grant layer is checked before RLS, so without these the staff policies further
-- down are dead code and every call in packages/module-expense/src/server.ts
-- fails with permission denied. That module reaches Postgres exclusively through
-- getSupabaseServerClient(), which is built from the anon key
-- (packages/data-supabase/src/server.ts:12), so it runs as `authenticated` and
-- never as `service_role`. Verbs are narrowed to what the module actually
-- issues, not granted wholesale.
grant select, insert, update, delete on public.expenses to authenticated;
grant select                        on public.expense_categories to authenticated;
grant select, insert                on public.expense_receipts to authenticated;

-- RLS. Per WAL-586 this must hold catalog-wide in every deploy: config.toml
-- exposes `public` over the Data API, so RLS is the only gate on these tables
-- whether or not a given client enabled this module.
alter table public.expense_categories enable row level security;
alter table public.expenses           enable row level security;
alter table public.expense_receipts   enable row level security;

drop policy if exists "expense_staff_all_expense_categories" on public.expense_categories;
create policy "expense_staff_all_expense_categories"
  on public.expense_categories for all
  to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "expense_staff_all_expenses" on public.expenses;
create policy "expense_staff_all_expenses"
  on public.expenses for all
  to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "expense_staff_all_expense_receipts" on public.expense_receipts;
create policy "expense_staff_all_expense_receipts"
  on public.expense_receipts for all
  to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Private bucket. Receipts are financial records: never public.
insert into storage.buckets (id, name, public)
values ('expense-receipts', 'expense-receipts', false)
on conflict (id) do nothing;

drop policy if exists "expense_staff_selects_expense_receipts_objects" on storage.objects;
create policy "expense_staff_selects_expense_receipts_objects"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'expense-receipts' and public.is_staff());

drop policy if exists "expense_staff_inserts_expense_receipts_objects" on storage.objects;
create policy "expense_staff_inserts_expense_receipts_objects"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'expense-receipts' and public.is_staff());

drop policy if exists "expense_staff_updates_expense_receipts_objects" on storage.objects;
create policy "expense_staff_updates_expense_receipts_objects"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'expense-receipts' and public.is_staff())
  with check (bucket_id = 'expense-receipts' and public.is_staff());

drop policy if exists "expense_staff_deletes_expense_receipts_objects" on storage.objects;
create policy "expense_staff_deletes_expense_receipts_objects"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'expense-receipts' and public.is_staff());
