-- Staff RLS coverage for lead triage.
-- Public lead submission is RPC-only (0026 revoked direct INSERT and dropped the
-- lead_capture_insert policy); leads are created exclusively via submit_lead().
-- So grant staff only select+update here — do NOT re-grant INSERT.

grant select, update on public.leads to authenticated;

drop policy if exists "lead_capture_staff_reads_leads" on public.leads;
create policy "lead_capture_staff_reads_leads"
  on public.leads for select
  to authenticated
  using (public.is_staff());

drop policy if exists "lead_capture_staff_updates_leads" on public.leads;
create policy "lead_capture_staff_updates_leads"
  on public.leads for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());
