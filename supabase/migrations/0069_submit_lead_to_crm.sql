-- Web form submissions that land in the CRM, not just the lead inbox (WAL-840).
--
-- submit_lead_to_crm stores the lead and its attachments exactly as
-- submit_lead_with_attachments does, then files the submission against a CRM
-- client:
--
--   1. A contact with the same email (or, with no email, the same phone) is the
--      same person; their account is the client.
--   2. Otherwise an account with the same business email domain or the same
--      name (case-insensitive) is the client.
--   3. Otherwise a new account is created, named after the company.
--
-- The submitter becomes a contact on that account if they are not one already.
-- The account's most recently updated open deal is the existing project the
-- submission belongs to; with no open deal, a new one opens in the first stage
-- of the active pipeline. The full submission is logged on the deal as a note.
--
-- Anon may call it: it can only add a lead, a note and, for an unknown sender,
-- a new account, contact and deal. It never edits or reveals an existing record
-- beyond linking an account-less contact to the account it matched, and it
-- returns only the new lead's id.

-- Logo files arrive as SVG more often than not, so the lead attachment bucket
-- and the attachment RPC accept image/svg+xml. The bucket stays private; staff
-- read files through signed URLs only.

update storage.buckets
   set allowed_mime_types = array_append(allowed_mime_types, 'image/svg+xml')
 where id = 'lead-attachments'
   and not ('image/svg+xml' = any (allowed_mime_types));

alter table public.lead_attachments
  drop constraint lead_attachments_mime_type_check,
  add constraint lead_attachments_mime_type_check check (mime_type = any (array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/svg+xml'
  ]));

create or replace function public.submit_lead_with_attachments (
  p_name        text,
  p_email       text,
  p_company     text  DEFAULT NULL::text,
  p_source      text  DEFAULT NULL::text,
  p_phone       text  DEFAULT NULL::text,
  p_office      text  DEFAULT NULL::text,
  p_notes       text  DEFAULT NULL::text,
  p_ip_hash     text  DEFAULT NULL::text,
  p_user_agent  text  DEFAULT NULL::text,
  p_metadata    jsonb DEFAULT '{}'::jsonb,
  p_attachments jsonb DEFAULT '[]'::jsonb
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_lead_id uuid;
  v_attachment jsonb;
  v_storage_path text;
  v_file_name text;
  v_mime_type text;
  v_size_bytes bigint;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'name is required';
  end if;

  if v_email is null and v_phone is null then
    raise exception 'an email address or a phone number is required';
  end if;

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

  if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
    raise exception 'attachments must be an array';
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
  ) returning id into v_lead_id;

  for v_attachment in
    select value from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb))
  loop
    if jsonb_typeof(v_attachment) <> 'object' then
      raise exception 'attachment must be an object';
    end if;

    v_storage_path := btrim(coalesce(v_attachment ->> 'storage_path', ''));
    v_file_name := btrim(coalesce(v_attachment ->> 'file_name', ''));
    v_mime_type := lower(btrim(coalesce(v_attachment ->> 'mime_type', '')));

    if coalesce(v_attachment ->> 'size_bytes', '') !~ '^[0-9]+$' then
      raise exception 'attachment size is invalid';
    end if;
    v_size_bytes := (v_attachment ->> 'size_bytes')::bigint;

    if char_length(v_storage_path) not between 1 and 1024
       or v_storage_path ~ '^/'
       or char_length(v_file_name) not between 1 and 255
       or v_mime_type not in (
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'image/gif',
         'image/jpeg',
         'image/png',
         'image/webp',
         'image/svg+xml'
       )
       or v_size_bytes not between 0 and 10485760 then
      raise exception 'attachment is invalid';
    end if;

    insert into public.lead_attachments (
      lead_id, storage_path, file_name, mime_type, size_bytes
    ) values (
      v_lead_id, v_storage_path, v_file_name, v_mime_type, v_size_bytes
    );
  end loop;

  return v_lead_id;
end;
$function$;

create or replace function public.submit_lead_to_crm (
  p_name        text,
  p_email       text,
  p_company     text  default null::text,
  p_source      text  default null::text,
  p_phone       text  default null::text,
  p_office      text  default null::text,
  p_notes       text  default null::text,
  p_ip_hash     text  default null::text,
  p_user_agent  text  default null::text,
  p_metadata    jsonb default '{}'::jsonb,
  p_attachments jsonb default '[]'::jsonb,
  p_deal_name   text  default null::text
)
  returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  v_lead_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_company text := nullif(btrim(coalesce(p_company, '')), '');
  v_domain text;
  v_first text;
  v_contact_id uuid;
  v_account_id uuid;
  v_opportunity_id uuid;
  v_stage_id uuid;
begin
  -- Validates every field and raises on bad input before anything below runs.
  v_lead_id := public.submit_lead_with_attachments(
    p_name, p_email, p_company, p_source, p_phone, p_office, p_notes,
    p_ip_hash, p_user_agent, p_metadata, p_attachments
  );

  v_domain := nullif(split_part(coalesce(v_email, ''), '@', 2), '');
  if v_domain in (
    'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
    'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com',
    'proton.me', 'protonmail.com', 'comcast.net', 'att.net', 'sbcglobal.net',
    'verizon.net', 'ymail.com', 'gmx.com', 'mail.com'
  ) then
    v_domain := null;
  end if;

  select c.id, c.account_id into v_contact_id, v_account_id
    from public.contacts c
   where c.deleted_at is null
     and ((v_email is not null and lower(c.email) = v_email)
       or (v_email is null and c.phone = v_phone))
   order by c.updated_at desc
   limit 1;

  if v_account_id is null then
    select a.id into v_account_id
      from public.accounts a
     where a.deleted_at is null
       and ((v_domain is not null and lower(a.domain) = v_domain)
         or (v_company is not null and lower(a.name) = lower(v_company)))
     order by a.updated_at desc
     limit 1;
  end if;

  if v_account_id is null then
    insert into public.accounts (name, domain, notes)
    values (
      left(coalesce(v_company, v_name), 200),
      v_domain,
      'Created from a ' || coalesce(nullif(btrim(p_source), ''), 'web form') || ' submission.'
    )
    returning id into v_account_id;
  end if;

  if v_contact_id is null then
    v_first := split_part(v_name, ' ', 1);
    insert into public.contacts (account_id, lead_id, first_name, last_name, email, phone)
    values (
      v_account_id,
      v_lead_id,
      v_first,
      nullif(btrim(substr(v_name, char_length(v_first) + 1)), ''),
      v_email,
      v_phone
    )
    returning id into v_contact_id;
  else
    update public.contacts
       set account_id = v_account_id
     where id = v_contact_id and account_id is null;
  end if;

  select o.id into v_opportunity_id
    from public.crm_opportunities o
   where o.account_id = v_account_id
     and o.status = 'open'
     and o.deleted_at is null
   order by o.updated_at desc
   limit 1;

  if v_opportunity_id is null then
    select s.id into v_stage_id
      from public.crm_pipeline_stages s
      join public.crm_pipelines p on p.id = s.pipeline_id
     where p.is_active and s.active and not s.is_won and not s.is_lost
     order by p.order_index, s.sort_order
     limit 1;

    insert into public.crm_opportunities (account_id, contact_id, stage_id, name, status)
    values (
      v_account_id,
      v_contact_id,
      v_stage_id,
      left(coalesce(nullif(btrim(coalesce(p_deal_name, '')), ''), coalesce(v_company, v_name)), 200),
      'open'
    )
    returning id into v_opportunity_id;

    insert into public.crm_deal_contacts (deal_id, contact_id, is_primary)
    values (v_opportunity_id, v_contact_id, true);
  else
    insert into public.crm_deal_contacts (deal_id, contact_id, is_primary)
    values (v_opportunity_id, v_contact_id, false)
    on conflict (deal_id, contact_id) do nothing;
  end if;

  insert into public.crm_activities (opportunity_id, contact_id, account_id, type, body)
  values (
    v_opportunity_id,
    v_contact_id,
    v_account_id,
    'note',
    left(
      'Web form: ' || coalesce(nullif(btrim(p_source), ''), 'unknown') || E'\n'
        || 'From: ' || v_name || coalesce(' <' || v_email || '>', '') || coalesce(' ' || v_phone, '')
        || coalesce(E'\n\n' || nullif(btrim(p_notes), ''), '')
        || E'\n\nLead ' || v_lead_id::text,
      10000
    )
  );

  return v_lead_id;
end;
$function$;

revoke all on function public.submit_lead_to_crm(text, text, text, text, text, text, text, text, text, jsonb, jsonb, text) from public;
grant execute on function public.submit_lead_to_crm(text, text, text, text, text, text, text, text, text, jsonb, jsonb, text) to anon, authenticated, service_role;
