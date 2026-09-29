-- Staff RLS coverage for contract e-sign operator workflows.

grant select, insert, update on public.contracts to authenticated;

drop policy if exists "contract_esign_staff_reads_contracts" on public.contracts;
create policy "contract_esign_staff_reads_contracts"
  on public.contracts for select
  to authenticated
  using (public.is_staff());

drop policy if exists "contract_esign_staff_inserts_contracts" on public.contracts;
create policy "contract_esign_staff_inserts_contracts"
  on public.contracts for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists "contract_esign_staff_updates_contracts" on public.contracts;
create policy "contract_esign_staff_updates_contracts"
  on public.contracts for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "contract_esign_staff_reads_contract_objects" on storage.objects;
create policy "contract_esign_staff_reads_contract_objects"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'contracts' and public.is_staff());

drop policy if exists "contract_esign_staff_inserts_contract_objects" on storage.objects;
create policy "contract_esign_staff_inserts_contract_objects"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'contracts' and public.is_staff());
