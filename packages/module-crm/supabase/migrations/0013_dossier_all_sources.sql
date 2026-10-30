-- Auto-dossier for every new lead, not only /dig (Mike, 2026-10-19: "we need dossier whenever we get a new lead").
-- Same grants and RPCs as 0071; the source filter now skips only test/verify/probe submissions.

-- Read: only the columns the task needs, every non-test source.
grant select (id, submitted_at, source, name, company, office, email, phone, notes, metadata) on public.leads to dossier_worker;
drop policy if exists dossier_worker_reads_dig_leads on public.leads;
create policy dossier_worker_reads_dig_leads on public.leads for select to dossier_worker using (source !~ '(test|verify|probe)');

-- Attachments: insert a PDF row for a lead; read nothing back.
grant insert on public.lead_attachments to dossier_worker;
drop policy if exists dossier_worker_inserts_attachments on public.lead_attachments;
create policy dossier_worker_inserts_attachments on public.lead_attachments for insert to dossier_worker
  with check (
    storage_path like 'dossiers/%' and mime_type = 'application/pdf'
    and exists (select 1 from public.leads l where l.id = lead_id and l.source !~ '(test|verify|probe)')
  );
-- The worker must see its own inserted row for RETURNING / dedupe by path.
grant select (id, lead_id, storage_path) on public.lead_attachments to dossier_worker;
drop policy if exists dossier_worker_reads_own_attachments on public.lead_attachments;
create policy dossier_worker_reads_own_attachments on public.lead_attachments for select to dossier_worker
  using (storage_path like 'dossiers/%');

-- Storage: upload (and read back) only under dossiers/ in the private bucket.
grant insert, select on storage.objects to dossier_worker;
drop policy if exists dossier_worker_uploads_dossiers on storage.objects;
create policy dossier_worker_uploads_dossiers on storage.objects for insert to dossier_worker
  with check (bucket_id = 'lead-attachments' and name like 'dossiers/%');
drop policy if exists dossier_worker_reads_dossiers on storage.objects;
create policy dossier_worker_reads_dossiers on storage.objects for select to dossier_worker
  using (bucket_id = 'lead-attachments' and name like 'dossiers/%');

-- The only way metadata changes. Both run as owner, are executable by dossier_worker alone.
drop function if exists public.claim_dig_lead(timestamptz, int);
create or replace function public.claim_dig_lead(p_since timestamptz, p_max_inflight int default 2)
returns table (id uuid, name text, company text, office text, email text, phone text, notes text, metadata jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if (select count(*) from public.leads c where c.source !~ '(test|verify|probe)' and c.metadata->>'dossier_status' = 'queued') >= p_max_inflight then
    return;
  end if;
  select l.id into v_id from public.leads l
   where l.source !~ '(test|verify|probe)' and l.submitted_at > p_since and l.metadata->>'dossier_status' is null
   order by l.submitted_at limit 1 for update skip locked;
  if v_id is null then return; end if;
  update public.leads l set metadata = l.metadata || jsonb_build_object('dossier_status', 'queued', 'dossier_claimed_at', now(),
       'dossier_attempts', coalesce((l.metadata->>'dossier_attempts')::int, 0) + 1)
   where l.id = v_id;
  return query select l.id, l.name, l.company, l.office, l.email, l.phone, l.notes, l.metadata from public.leads l where l.id = v_id;
end $$;

create or replace function public.finish_dig_dossier(p_lead_id uuid, p_status text, p_path text, p_error text, p_cost jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('done', 'failed', 'queued', 'retry') then raise exception 'bad status %', p_status; end if;
  if p_path is not null and p_path not like 'dossiers/%' then raise exception 'bad path'; end if;
  -- 'retry' returns the lead to the unclaimed pool; the next claim_dig_lead picks it up again.
  update public.leads l set metadata = (case when p_status = 'retry'
        then l.metadata - 'dossier_status' - 'dossier_workflow_id' - 'dossier_claimed_at' else l.metadata end)
      || jsonb_strip_nulls(jsonb_build_object(
      'dossier_status', case when p_status = 'retry' then null else p_status end, 'dossier_path', p_path,
      'dossier_error', left(p_error, 500), 'dossier_cost', p_cost, 'dossier_workflow_id', p_cost->>'workflow_id',
      'dossier_updated_at', now()))
   where l.id = p_lead_id and l.source !~ '(test|verify|probe)';
  if not found then raise exception 'no lead %', p_lead_id; end if;
end $$;

revoke all on function public.claim_dig_lead(timestamptz, int) from public, anon, authenticated;
revoke all on function public.finish_dig_dossier(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_dig_lead(timestamptz, int) to dossier_worker;
grant execute on function public.finish_dig_dossier(uuid, text, text, text, jsonb) to dossier_worker;
