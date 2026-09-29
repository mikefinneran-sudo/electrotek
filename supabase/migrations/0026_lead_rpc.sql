-- WAL-389: harden lead capture.
--
-- Replaces the direct anon INSERT grant on public.leads with a SECURITY DEFINER
-- RPC so server-side validation runs even if the public form / API route is
-- bypassed. The JS honeypot + rate-limit in the route remain the first layer.

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
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'name is required';
  end if;
  if p_email is null
     or p_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or char_length(p_email) > 254 then
    raise exception 'a valid email is required';
  end if;
  -- Enforce every length the leads CHECK constraints would, so the RPC is a
  -- complete server-side backstop (raises a clean error, not a raw PG violation).
  if char_length(btrim(p_name)) > 200
     or char_length(btrim(coalesce(p_company, ''))) > 200
     or char_length(coalesce(p_notes, '')) > 5000
     or char_length(coalesce(p_phone, '')) > 50
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
    lower(btrim(p_email)),
    p_phone,
    p_office,
    p_notes,
    p_ip_hash,
    p_user_agent,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

-- Direct table insert is no longer allowed; the RPC (definer) is the only path.
revoke insert on public.leads from anon, authenticated;
drop policy if exists "lead_capture_insert" on public.leads;

revoke all on function public.submit_lead(
  text, text, text, text, text, text, text, text, text, jsonb
) from public;
grant execute on function public.submit_lead(
  text, text, text, text, text, text, text, text, text, jsonb
) to anon, authenticated;
