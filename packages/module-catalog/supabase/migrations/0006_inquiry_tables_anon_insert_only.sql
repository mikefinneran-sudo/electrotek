-- WAL-866: the two public inquiry forms are insert-only for anon.
--
-- 0046 grants anon INSERT on event_requests and wholesale_inquiries, but never
-- withdraws what a legacy project's default privileges handed anon when 0002
-- created the tables: every privilege, SELECT, UPDATE, DELETE and TRUNCATE
-- included. 0062 removed that default for tables created later; these two
-- predate it. RLS has no anon read, update or delete policy on either table,
-- so the Data API returned nothing, but the grant layer is the contract the
-- WAL-586 deny-by-default suite asserts, and TRUNCATE is not subject to RLS.
-- Measured 2026-10-20: anon held arwdDxtm on both tables in the electrotek,
-- acme-demo and freebies-fireworks projects, and only INSERT in waltersignal.

revoke all privileges on table public.event_requests, public.wholesale_inquiries from anon;
grant insert on table public.event_requests, public.wholesale_inquiries to anon;
