-- Referral partner applications from waltersignal.io/partners.
--
-- A visitor completes the partner wizard and click-accepts the Referral
-- Partner Agreement. The application, the accepted agreement text and the
-- generated page content land here as 'pending'. Nothing renders on
-- waltersignal.io until Provider approves it.
--
-- APPROVAL TOKEN. submit_partner_application generates the token itself and
-- writes the approve link only into the CRM lead (public.leads, staff-read
-- only). The caller never sees it, and only its SHA-256 is stored here. The
-- anon key is public, so a caller-chosen token would let anyone approve their
-- own application; this shape is why it cannot.
--
-- The table has no grants to anon or authenticated. The three SECURITY
-- DEFINER functions below are the only paths in or out, and get_live_partner
-- returns approved rows only.

create table if not exists public.referral_partners (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  status text not null default 'pending' check (status in ('pending', 'approved')),
  legal_name text not null check (char_length(legal_name) between 1 and 200),
  person text not null check (char_length(person) between 1 and 60),
  business text not null check (char_length(business) between 1 and 200),
  email text not null check (char_length(email) between 3 and 254),
  phone text check (char_length(phone) <= 50),
  address text not null check (char_length(address) between 1 and 300),
  page jsonb not null check (jsonb_typeof(page) = 'object' and pg_column_size(page) < 16384),
  application jsonb not null check (jsonb_typeof(application) = 'object' and pg_column_size(application) < 16384),
  agreement_text text not null check (char_length(agreement_text) between 1000 and 60000),
  agreement_version text not null check (agreement_version ~ '^[0-9a-f]{64}$'),
  accepted_name text not null check (char_length(accepted_name) between 1 and 200),
  accepted_title text not null check (char_length(accepted_title) between 1 and 120),
  accepted_at timestamptz not null default now(),
  approve_token_hash text not null,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

-- Pending rows may share a slug; only one approved partner can hold it. This
-- keeps an unapproved application from squatting on a name.
create unique index if not exists referral_partners_live_slug
  on public.referral_partners (slug) where status = 'approved';

comment on table public.referral_partners is
  'Referral partner applications and their accepted agreements. Written and read only through SECURITY DEFINER functions.';

alter table public.referral_partners enable row level security;
revoke all on public.referral_partners from anon, authenticated;
grant select on public.referral_partners to authenticated;

drop policy if exists "referral_partners_staff_read" on public.referral_partners;
create policy "referral_partners_staff_read"
  on public.referral_partners for select
  to authenticated
  using (public.is_staff());

create or replace function public.submit_partner_application(
  p_slug text,
  p_legal_name text,
  p_person text,
  p_business text,
  p_email text,
  p_phone text,
  p_address text,
  p_page jsonb,
  p_application jsonb,
  p_agreement_text text,
  p_agreement_version text,
  p_accepted_name text,
  p_accepted_title text,
  p_user_agent text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'a valid email is required';
  end if;

  if exists (select 1 from public.referral_partners where slug = p_slug and status = 'approved') then
    raise exception 'slug taken';
  end if;

  insert into public.referral_partners (
    slug, legal_name, person, business, email, phone, address, page, application,
    agreement_text, agreement_version, accepted_name, accepted_title, approve_token_hash
  ) values (
    p_slug, btrim(p_legal_name), btrim(p_person), btrim(p_business), v_email,
    nullif(btrim(coalesce(p_phone, '')), ''), btrim(p_address), p_page, p_application,
    p_agreement_text, p_agreement_version, btrim(p_accepted_name), btrim(p_accepted_title),
    encode(sha256(convert_to(v_token, 'UTF8')), 'hex')
  ) returning id into v_id;

  perform public.submit_lead(
    btrim(p_legal_name),
    v_email,
    btrim(p_business),
    'partner-application',
    nullif(btrim(coalesce(p_phone, '')), ''),
    btrim(p_address),
    format(
      E'Referral partner application. Agreement accepted by %s, %s.\nPage on approval: https://waltersignal.io/partners/%s\n\nApprove (publishes the page): https://waltersignal.io/api/partners/approve?id=%s&token=%s',
      btrim(p_accepted_name), btrim(p_accepted_title), p_slug, v_id, v_token
    ),
    null,
    p_user_agent,
    jsonb_build_object(
      'form', 'partner-application',
      'partner_id', v_id,
      'slug', p_slug,
      'application', p_application,
      'agreement_version', p_agreement_version
    )
  );

  return v_id;
end;
$$;

create or replace function public.approve_partner(p_id uuid, p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
begin
  update public.referral_partners
     set status = 'approved',
         approved_at = coalesce(approved_at, now())
   where id = p_id
     and approve_token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
  returning slug into v_slug;

  if v_slug is null then
    raise exception 'invalid approval link';
  end if;
  return v_slug;
end;
$$;

create or replace function public.get_live_partner(p_slug text)
returns table (slug text, person text, business text, page jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select r.slug, r.person, r.business, r.page
    from public.referral_partners r
   where r.slug = p_slug and r.status = 'approved';
$$;

revoke all on function public.submit_partner_application(text, text, text, text, text, text, text, jsonb, jsonb, text, text, text, text, text) from public;
revoke all on function public.approve_partner(uuid, text) from public;
revoke all on function public.get_live_partner(text) from public;
grant execute on function public.submit_partner_application(text, text, text, text, text, text, text, jsonb, jsonb, text, text, text, text, text) to anon, authenticated;
grant execute on function public.approve_partner(uuid, text) to anon, authenticated;
grant execute on function public.get_live_partner(text) to anon, authenticated;
