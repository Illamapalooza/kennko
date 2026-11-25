-- Bonus point reasons: walk-in cat check-in, counter card scan, and F2F-verified social story/post.
-- Each bonus type is capped at once per Manila day per customer via bonus_day.

alter table points_ledger
  drop constraint if exists points_ledger_reason_check;

alter table points_ledger
  add constraint points_ledger_reason_check
  check (reason in ('order', 'order_reversed', 'cosmetic', 'adjustment', 'checkin', 'card_scan', 'social_share'));

alter table points_ledger
  add column if not exists bonus_day date;

create unique index if not exists points_once_per_bonus_day
  on points_ledger (customer_id, reason, bonus_day)
  where bonus_day is not null;
