-- CRM platform-grade schema additions. Additive only: preserves legacy columns
-- while introducing pipelines, deal-contact roles, soft-delete, custom fields,
-- and authoritative opportunity status.

-- Authoritative opportunity status ------------------------------------------
alter table public.crm_opportunities
  add column if not exists lost_reason text;

do $$
begin
  update public.crm_opportunities
     set status = 'open'
   where status is null
      or status not in ('open', 'won', 'lost');

  if not exists (
    select 1
      from pg_constraint
     where conname = 'crm_opportunities_status_check'
       and conrelid = 'public.crm_opportunities'::regclass
  ) then
    alter table public.crm_opportunities
      add constraint crm_opportunities_status_check
      check (status in ('open', 'won', 'lost'));
  end if;
end $$;

comment on column public.crm_opportunities.status is
  'Authoritative opportunity lifecycle status for CRM: open, won, or lost.';
comment on column public.crm_opportunities.lost_reason is
  'Optional staff-entered reason when an opportunity status is lost.';
comment on column public.crm_opportunities.contact_id is
  'LEGACY compatibility pointer to the primary contact. Non-authoritative; crm_deal_contacts is the source of truth for deal-contact roles.';
comment on column public.crm_pipeline_stages.is_won is
  'LEGACY positional flag retained for compatibility. Non-authoritative; crm_opportunities.status is the source of truth.';
comment on column public.crm_pipeline_stages.is_lost is
  'LEGACY positional flag retained for compatibility. Non-authoritative; crm_opportunities.status is the source of truth.';

-- Pipelines ------------------------------------------------------------------
create table if not exists public.crm_pipelines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  order_index numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.crm_pipelines (id, name, is_active, order_index)
values ('11111111-0001-0001-0001-000000000000', 'Default Pipeline', true, 0)
on conflict do nothing;

alter table public.crm_pipeline_stages
  add column if not exists pipeline_id uuid;
alter table public.crm_pipeline_stages
  add column if not exists probability_weight numeric not null default 0;
alter table public.crm_pipeline_stages
  add column if not exists rotten_days integer;
alter table public.crm_pipeline_stages
  add column if not exists required_fields jsonb not null default '[]'::jsonb;

update public.crm_pipeline_stages
   set pipeline_id = '11111111-0001-0001-0001-000000000000',
       probability_weight = case id
         when '11111111-0001-0001-0001-000000000001' then 0.1
         when '11111111-0001-0001-0001-000000000002' then 0.25
         when '11111111-0001-0001-0001-000000000003' then 0.5
         when '11111111-0001-0001-0001-000000000004' then 0.75
         when '11111111-0001-0001-0001-000000000005' then 1.0
         when '11111111-0001-0001-0001-000000000006' then 0.0
         else probability_weight
       end
 where id in (
   '11111111-0001-0001-0001-000000000001',
   '11111111-0001-0001-0001-000000000002',
   '11111111-0001-0001-0001-000000000003',
   '11111111-0001-0001-0001-000000000004',
   '11111111-0001-0001-0001-000000000005',
   '11111111-0001-0001-0001-000000000006'
 );

update public.crm_pipeline_stages
   set probability_weight = 0
 where probability_weight is null
    or probability_weight < 0
    or probability_weight > 1;

update public.crm_pipeline_stages
   set rotten_days = null
 where rotten_days < 0;

update public.crm_pipeline_stages
   set required_fields = '[]'::jsonb
 where required_fields is null
    or jsonb_typeof(required_fields) <> 'array';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'crm_pipeline_stages_pipeline_id_fkey'
       and conrelid = 'public.crm_pipeline_stages'::regclass
  ) then
    alter table public.crm_pipeline_stages
      add constraint crm_pipeline_stages_pipeline_id_fkey
      foreign key (pipeline_id)
      references public.crm_pipelines(id)
      on delete cascade;
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'crm_pipeline_stages_probability_weight_check'
       and conrelid = 'public.crm_pipeline_stages'::regclass
  ) then
    alter table public.crm_pipeline_stages
      add constraint crm_pipeline_stages_probability_weight_check
      check (probability_weight >= 0 and probability_weight <= 1);
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'crm_pipeline_stages_rotten_days_check'
       and conrelid = 'public.crm_pipeline_stages'::regclass
  ) then
    alter table public.crm_pipeline_stages
      add constraint crm_pipeline_stages_rotten_days_check
      check (rotten_days is null or rotten_days >= 0);
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'crm_pipeline_stages_required_fields_check'
       and conrelid = 'public.crm_pipeline_stages'::regclass
  ) then
    alter table public.crm_pipeline_stages
      add constraint crm_pipeline_stages_required_fields_check
      check (jsonb_typeof(required_fields) = 'array');
  end if;
end $$;

create index if not exists crm_pipeline_stages_pipeline_id_idx
  on public.crm_pipeline_stages (pipeline_id);

comment on table public.crm_pipelines is
  'Owned by @waltersignal/bananaforce-module-crm. Deal pipeline definitions. Staff/service-role managed: no anon or authenticated access. Reads/writes go through the service-role client in server.ts.';
comment on column public.crm_pipeline_stages.pipeline_id is
  'Pipeline owning this stage. The default seeded stages are attached to the default CRM pipeline.';
comment on column public.crm_pipeline_stages.sort_order is
  'Canonical stage order within a pipeline. Reused for stage reordering; no duplicate order_index exists on stages.';
comment on column public.crm_pipeline_stages.probability_weight is
  'Weighted pipeline probability for open opportunities in this stage, from 0 to 1.';
comment on column public.crm_pipeline_stages.rotten_days is
  'Optional nonnegative age threshold, in days, after which an opportunity in this stage is considered stale.';
comment on column public.crm_pipeline_stages.required_fields is
  'JSON array of field identifiers required before a deal may enter or leave this stage.';

-- Deal/contact junction ------------------------------------------------------
create table if not exists public.crm_deal_contacts (
  deal_id uuid not null references public.crm_opportunities(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  role text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (deal_id, contact_id)
);

insert into public.crm_deal_contacts (deal_id, contact_id, role, is_primary)
select id, contact_id, null, true
  from public.crm_opportunities
 where contact_id is not null
on conflict do nothing;

create index if not exists crm_deal_contacts_deal_id_idx
  on public.crm_deal_contacts (deal_id);
create index if not exists crm_deal_contacts_contact_id_idx
  on public.crm_deal_contacts (contact_id);
create unique index if not exists crm_deal_contacts_one_primary_per_deal_idx
  on public.crm_deal_contacts (deal_id)
  where is_primary;

comment on table public.crm_deal_contacts is
  'Owned by @waltersignal/bananaforce-module-crm. Many-to-many opportunity/contact roles. Staff/service-role managed: no anon or authenticated access. Reads/writes go through the service-role client in server.ts.';
comment on column public.crm_deal_contacts.deal_id is
  'FK to crm_opportunities.id; deleted when the deal is deleted.';
comment on column public.crm_deal_contacts.contact_id is
  'FK to contacts.id; deleted when the contact is deleted.';
comment on column public.crm_deal_contacts.role is
  'Optional contact role for this deal, such as decision maker, influencer, or billing.';
comment on column public.crm_deal_contacts.is_primary is
  'Whether this contact is the primary contact for the deal. At most one primary contact is allowed per deal.';

-- Soft-delete and custom fields ---------------------------------------------
alter table public.accounts
  add column if not exists deleted_at timestamptz;
alter table public.contacts
  add column if not exists deleted_at timestamptz;
alter table public.crm_opportunities
  add column if not exists deleted_at timestamptz;

alter table public.accounts
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table public.contacts
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table public.crm_opportunities
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

create index if not exists accounts_active_keyset_idx
  on public.accounts (created_at desc, id desc)
  where deleted_at is null;
create index if not exists contacts_active_keyset_idx
  on public.contacts (created_at desc, id desc)
  where deleted_at is null;
create index if not exists crm_opportunities_active_keyset_idx
  on public.crm_opportunities (created_at desc, id desc)
  where deleted_at is null;

create index if not exists accounts_custom_fields_gin_idx
  on public.accounts using gin (custom_fields);
create index if not exists contacts_custom_fields_gin_idx
  on public.contacts using gin (custom_fields);
create index if not exists crm_opportunities_custom_fields_gin_idx
  on public.crm_opportunities using gin (custom_fields);

comment on column public.accounts.deleted_at is
  'Soft-delete timestamp. Active CRM reads filter deleted_at is null in server.ts, not in RLS.';
comment on column public.contacts.deleted_at is
  'Soft-delete timestamp. Active CRM reads filter deleted_at is null in server.ts, not in RLS.';
comment on column public.crm_opportunities.deleted_at is
  'Soft-delete timestamp. Active CRM reads filter deleted_at is null in server.ts, not in RLS.';
comment on column public.accounts.custom_fields is
  'Module-owned JSON object for client-specific CRM account fields.';
comment on column public.contacts.custom_fields is
  'Module-owned JSON object for client-specific CRM contact fields.';
comment on column public.crm_opportunities.custom_fields is
  'Module-owned JSON object for client-specific CRM opportunity fields.';

-- updated_at triggers for new tables ----------------------------------------
drop trigger if exists crm_pipelines_set_updated_at on public.crm_pipelines;
create trigger crm_pipelines_set_updated_at
  before update on public.crm_pipelines
  for each row execute function public.crm_set_updated_at();

drop trigger if exists crm_deal_contacts_set_updated_at on public.crm_deal_contacts;
create trigger crm_deal_contacts_set_updated_at
  before update on public.crm_deal_contacts
  for each row execute function public.crm_set_updated_at();

-- RLS + revoke for new tables ------------------------------------------------
alter table public.crm_pipelines enable row level security;
alter table public.crm_deal_contacts enable row level security;

revoke all on public.crm_pipelines from anon, authenticated;
revoke all on public.crm_deal_contacts from anon, authenticated;

-- Additive staff RLS policies (forward path, keyed off public.is_staff()).

-- crm_pipelines
drop policy if exists crm_staff_pipelines_select on public.crm_pipelines;
create policy crm_staff_pipelines_select on public.crm_pipelines
  for select to authenticated
  using (public.is_staff());

drop policy if exists crm_staff_pipelines_insert on public.crm_pipelines;
create policy crm_staff_pipelines_insert on public.crm_pipelines
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists crm_staff_pipelines_update on public.crm_pipelines;
create policy crm_staff_pipelines_update on public.crm_pipelines
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- crm_deal_contacts
drop policy if exists crm_staff_deal_contacts_select on public.crm_deal_contacts;
create policy crm_staff_deal_contacts_select on public.crm_deal_contacts
  for select to authenticated
  using (public.is_staff());

drop policy if exists crm_staff_deal_contacts_insert on public.crm_deal_contacts;
create policy crm_staff_deal_contacts_insert on public.crm_deal_contacts
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists crm_staff_deal_contacts_update on public.crm_deal_contacts;
create policy crm_staff_deal_contacts_update on public.crm_deal_contacts
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists crm_staff_deal_contacts_delete on public.crm_deal_contacts;
create policy crm_staff_deal_contacts_delete on public.crm_deal_contacts
  for delete to authenticated
  using (public.is_staff());
