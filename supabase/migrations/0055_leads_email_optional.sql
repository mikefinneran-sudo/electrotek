-- A lead may arrive with a phone number and no email.
--
-- 0005_lead_capture.sql made email NOT NULL, which is right for the form it was
-- written for: a marketing site asking a knowledge worker to get in touch, where
-- the reply is going to be an email and there is no lead without an address to
-- send it to.
--
-- It is wrong for the referral traffic /dig is about to take. Those visitors are
-- shop owners and tradesmen arriving on a phone from a YouTube video, and the
-- capture form asks for a name and a phone number and nothing else on purpose --
-- each additional required field on a phone screen costs submissions, and this
-- buyer is reached by calling him back, not by emailing him. Requiring an
-- address there does not produce better leads; it produces fewer leads and a
-- column full of addresses nobody typed carefully.
--
-- What must not happen is a lead with no way to reach anyone at all. So the
-- NOT NULL moves from email specifically to contactability generally: a row
-- needs an email or a phone number, and the format check still applies to any
-- email that is supplied.
--
-- submit_lead keeps its exact signature, so every existing caller continues to
-- work unchanged -- apps/waltersignal's /api/contact still passes an email and
-- still gets the same validation. Only the "email is mandatory" rule is
-- replaced by "email or phone is mandatory".

alter table public.leads
  alter column email drop not null;

alter table public.leads
  drop constraint if exists leads_email_check;

alter table public.leads
  add constraint leads_email_check check (
    email is null
    or (
      char_length(email) <= 254
      and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  );

alter table public.leads
  drop constraint if exists leads_contactable_check;

alter table public.leads
  add constraint leads_contactable_check check (
    coalesce(btrim(email), '') <> '' or coalesce(btrim(phone), '') <> ''
  );

-- Same signature as 0026_lead_rpc.sql, so this replaces rather than overloads.
create or replace function public.submit_lead(
  p_name text,
  p_email text,
  p_company text default null,
  p_source text default null,
  p_phone text default null,
  p_office text default null,
  p_notes text default null,
  p_ip_hash text default null,
  p_user_agent text default null,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'name is required';
  end if;

  -- Contactability, not email specifically.
  if v_email is null and v_phone is null then
    raise exception 'an email address or a phone number is required';
  end if;

  -- An email that is supplied still has to be a real one.
  if v_email is not null
     and (v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          or char_length(v_email) > 254) then
    raise exception 'a valid email is required';
  end if;

  if char_length(btrim(p_name)) > 200
     or char_length(btrim(coalesce(p_company, ''))) > 200
     or char_length(coalesce(p_notes, '')) > 5000
     or char_length(coalesce(v_phone, '')) > 50
     or char_length(coalesce(p_office, '')) > 300
     or char_length(coalesce(p_source, '')) > 100 then
    raise exception 'field too long';
  end if;

  insert into public.leads (
    status, source, name, company, email, phone, office, notes, ip_hash, user_agent, metadata
  ) values (
    'new',
    p_source,
    btrim(p_name),
    nullif(btrim(coalesce(p_company, '')), ''),
    lower(v_email),
    v_phone,
    p_office,
    p_notes,
    p_ip_hash,
    p_user_agent,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.submit_lead(
  text, text, text, text, text, text, text, text, text, jsonb
) from public;
grant execute on function public.submit_lead(
  text, text, text, text, text, text, text, text, text, jsonb
) to anon, authenticated;
