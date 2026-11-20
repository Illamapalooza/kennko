-- Needs a look and the day report: set-aside (discarded) receipts, shifts closed
-- from admin, and a seen mark on flagged orders.
--
-- Resolving a receipt is a status, never a delete. A held receipt the owner sets
-- aside becomes 'discarded' with who, when and why. A flagged receipt the owner
-- has looked at keeps result 'flagged' and gets resolved_* set.
--
-- Every existing row passes the new checks: no row is 'discarded' yet, and the
-- new columns start null (closed_in_admin false).

-- 1. sync_events: a 'discarded' result and its resolution.
alter table sync_events drop constraint sync_events_result_check;
alter table sync_events add constraint sync_events_result_check
  check (result in ('applied', 'flagged', 'held', 'discarded'));

alter table sync_events
  add column resolved_at  timestamptz,
  add column resolved_by  uuid references staff(id),
  add column resolve_note text check (char_length(resolve_note) between 1 and 200);

alter table sync_events add constraint sync_events_discarded_resolved check (
  result <> 'discarded' or (resolved_at is not null and resolved_by is not null and resolve_note is not null)
);

-- Needs a look: held receipts and flagged ones nobody has looked at, newest first.
create index sync_events_open on sync_events (received_at desc)
  where result = 'held' or (result = 'flagged' and resolved_at is null);

-- 2. shifts: a stuck open shift closed by the owner from admin.
alter table shifts add column closed_in_admin boolean not null default false;

-- 3. orders: the owner has looked at this order's flags. The report reads by business day.
alter table orders
  add column flags_seen_at timestamptz,
  add column flags_seen_by uuid references staff(id);

create index orders_business_day_idx on orders (business_day);

-- 4. Privileges. kennko_api already holds select, insert and update on all three
-- tables (0014, 0017) and never delete. orders keeps 0014's table-level select
-- for anon and authenticated, limited by RLS; the two new columns hold only a
-- time and a staff id.
revoke all on sync_events, shifts from anon, authenticated;
