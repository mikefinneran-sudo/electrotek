-- Add generic external source metadata for idempotent ticket creation.
-- Email inbox tickets are the first source; client-portal issue_reports can
-- reuse source/source_ref when that Wave 2/3 merge lands.

alter table public.tickets
  add column if not exists source text;

alter table public.tickets
  add column if not exists source_ref text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'tickets'
      and c.conname = 'tickets_source_ref_pair_check'
  ) then
    alter table public.tickets
      add constraint tickets_source_ref_pair_check
      check (
        (source is null and source_ref is null)
        or (source is not null and source_ref is not null)
      );
  end if;
end
$$;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'tickets'
      and c.contype = 'c'
      and exists (
        select 1
        from unnest(c.conkey) as cols(attnum)
        join pg_attribute a on a.attrelid = r.oid
          and a.attnum = cols.attnum
        where a.attname = 'channel'
      )
  loop
    execute format('alter table public.tickets drop constraint %I', constraint_name);
  end loop;

  alter table public.tickets
    add constraint tickets_channel_check
    check (channel in ('internal', 'client', 'email'));
end
$$;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'ticket_replies'
      and c.contype = 'c'
      and exists (
        select 1
        from unnest(c.conkey) as cols(attnum)
        join pg_attribute a on a.attrelid = r.oid
          and a.attnum = cols.attnum
        where a.attname = 'author_kind'
      )
  loop
    execute format(
      'alter table public.ticket_replies drop constraint %I',
      constraint_name
    );
  end loop;

  alter table public.ticket_replies
    add constraint ticket_replies_author_kind_check
    check (author_kind in ('staff', 'client', 'contact'));
end
$$;

create unique index if not exists tickets_source_ref_uidx
  on public.tickets (source, source_ref)
  where source is not null;

comment on table public.tickets is
  'Owned by @waltersignal/bananaforce-module-ticketing. Helpdesk tickets with staff and client-facing surfaces. inspection_id (nullable, plain uuid) links to the client-portal token inspection for client-scoped access. source/source_ref are the generic external-source dedupe key for inbound systems such as inbox email and future issue_reports. Staff/service-role managed: RLS enabled, no anon/authenticated access at runtime. Staff RLS policies (forward path) key off public.is_staff().';

-- Reply-level idempotency.
--
-- Ticket creation is protected by tickets_source_ref_uidx above: a bridge that
-- crashes after the remote insert but before writing its own local record will
-- retry, and the unique index makes the retry a no-op that returns the existing
-- row. Replies had no equivalent, so the same crash window produced a genuine
-- duplicate reply with no safety net. These columns close that gap using the
-- same (source, source_ref) shape, keyed per inbound message rather than per
-- thread.

alter table public.ticket_replies
  add column if not exists source text;

alter table public.ticket_replies
  add column if not exists source_ref text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'ticket_replies'
      and c.conname = 'ticket_replies_source_ref_pair_check'
  ) then
    alter table public.ticket_replies
      add constraint ticket_replies_source_ref_pair_check
      check (
        (source is null and source_ref is null)
        or (source is not null and source_ref is not null)
      );
  end if;
end
$$;

create unique index if not exists ticket_replies_source_ref_uidx
  on public.ticket_replies (source, source_ref)
  where source is not null;

comment on table public.ticket_replies is
  'Owned by @waltersignal/bananaforce-module-ticketing. Per-ticket reply thread. internal=true rows are staff-only notes never returned to client token holders. source/source_ref are the per-message external dedupe key that makes an inbound-bridge retry idempotent. Staff/service-role managed.';
