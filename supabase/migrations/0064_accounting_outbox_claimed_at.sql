-- Track when an outbox worker actually claimed a row. created_at describes
-- enqueue time and cannot safely drive processing-staleness decisions.

alter table public.ledger_outbox
  add column if not exists claimed_at timestamptz;

create index if not exists ledger_outbox_processing_claimed_idx
  on public.ledger_outbox (claimed_at)
  where status = 'processing';
