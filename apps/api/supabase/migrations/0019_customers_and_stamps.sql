-- Customer accounts, the digital stamp card and the points ledger (Plan 7).
--   customers      one row per signed-in user who joined, keyed by auth.users id
--   stamp_cards    8-stamp cards; open until full, then waiting for a free-drink claim
--   stamps         one per order (the till's id), on a card, or flagged mode_was_paper
--   points_ledger  append-only points; the balance is the sum
--   rate_limits    per-key minute windows shared by the serverless API instances
-- plus orders.customer_id, order_lines.is_reward, four new receipt kinds, and
-- owns_order() matching guest orders by email only after the account was created.
--
-- Existing rows pass every new check: no order has a customer yet, every line
-- starts with is_reward false, and the kind check keeps every old kind
-- (including the legacy import.* ones).

-- 1. Customers. Deleting the auth user deletes the customer and, by cascade,
-- their cards, stamps and ledger rows.
create table customers (
  id                  uuid primary key references auth.users(id) on delete cascade,
  public_code         text not null unique check (public_code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{9}$'),
  display_name        text not null check (char_length(display_name) between 1 and 40),
  stamp_mode          text not null default 'none' check (stamp_mode in ('none', 'digital', 'paper')),
  stamp_mode_set_by   uuid references staff(id),
  stamp_mode_set_at   timestamptz,
  age_confirmed_at    timestamptz not null,
  privacy_accepted_at timestamptz not null,
  privacy_version     text not null check (char_length(privacy_version) between 1 and 20),
  created_at          timestamptz not null
);

create index customers_display_name_idx on customers (lower(display_name));

-- 2. Orders gain the customer they were linked to; account deletion clears it.
alter table orders add column customer_id uuid references customers(id) on delete set null;
create index orders_customer_idx on orders (customer_id) where customer_id is not null;

alter table order_lines add column is_reward boolean not null default false;

-- 3. Stamp cards. A card stays open for stamping until it is full (filled_at),
-- not until it is claimed, so a 9th stamp rolls onto a fresh card while the
-- full one waits. Several full cards may wait; a claim takes the oldest.
create table stamp_cards (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references customers(id) on delete cascade,
  started_at        timestamptz not null,
  filled_at         timestamptz,
  claimed_at        timestamptz,
  claim_id          uuid unique,
  claimed_order_id  uuid references orders(id),
  claimed_by_staff  uuid references staff(id),
  claimed_device_id uuid references devices(id),
  check (claimed_at is null or filled_at is not null),
  check ((claimed_at is null) = (claim_id is null))
);

create unique index stamp_cards_one_open on stamp_cards (customer_id) where filled_at is null;

-- 4. Stamps. The id comes from the till. A stamp for a customer on paper has no
-- card and the mode_was_paper flag. Only one live stamp per order: a forgiven
-- stamp (kept on a claimed card after its order was cancelled or unlinked)
-- does not block stamping the order again.
create table stamps (
  id               uuid primary key,
  customer_id      uuid not null references customers(id) on delete cascade,
  card_id          uuid references stamp_cards(id) on delete cascade,
  order_id         uuid not null references orders(id),
  stamped_by_staff uuid references staff(id),
  device_id        uuid references devices(id),
  stamped_at       timestamptz not null,
  received_at      timestamptz not null,
  flags            text[] not null default '{}',
  resolved_at      timestamptz,
  resolved_by      uuid references staff(id),
  check (card_id is not null or 'mode_was_paper' = any(flags))
);

create unique index stamps_one_per_order on stamps (order_id) where not ('forgiven' = any(flags));
create index stamps_card_idx on stamps (card_id);

-- 5. Points. Integers, never money. An order is credited once and reversed once.
create table points_ledger (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references customers(id) on delete cascade,
  delta            int not null check (delta <> 0),
  reason           text not null check (reason in ('order', 'order_reversed', 'cosmetic', 'adjustment')),
  order_id         uuid references orders(id),
  -- Plan 8 adds the foreign key when the cosmetics table exists.
  cosmetic_id      uuid,
  note             text check (char_length(note) between 1 and 200),
  created_at       timestamptz not null,
  created_by_staff uuid references staff(id),
  check ((reason in ('order', 'order_reversed')) = (order_id is not null)),
  check (reason <> 'adjustment' or (created_by_staff is not null and note is not null))
);

create unique index points_once_per_order on points_ledger (order_id, reason) where order_id is not null;
create index points_ledger_customer_idx on points_ledger (customer_id, created_at desc);

-- 6. Rate limits: one row per key and minute window. Old windows are deleted on write.
create table rate_limits (
  key          text,
  window_start timestamptz,
  hits         int not null,
  primary key (key, window_start)
);

-- 7. Receipts for the four new till events.
alter table sync_events drop constraint sync_events_kind_check;
alter table sync_events add constraint sync_events_kind_check check (kind in (
  'order.created', 'order.prep_status', 'order.cancelled',
  'shift.opened', 'shift.closed', 'cash.moved', 'menu.availability',
  'import.shift', 'import.order', 'import.cash_move',
  'customer.linked', 'customer.unlinked', 'stamp.added', 'reward.used'
));

-- 8. owns_order: a guest order matches by confirmed email only when it was placed
-- after the signed-in user was created. auth.users.created_at cannot be set by
-- the user, and a deleted and re-created account gets a new one.
drop policy "customer reads own orders" on orders;
drop policy "customer reads own order lines" on order_lines;
drop policy "customer reads own order line options" on order_line_options;

create function public.owns_order(order_user_id uuid, order_email text, order_created_at timestamptz)
returns boolean
language sql
security definer
stable
set search_path = public, auth, pg_temp
as $$
  select
    auth.uid() is not null
    and (
      order_user_id = auth.uid()
      or exists (
        select 1 from auth.users u
        where u.id = auth.uid()
          and u.email_confirmed_at is not null
          and lower(u.email) = lower(order_email)
          and u.created_at <= order_created_at
      )
    );
$$;

revoke all on function public.owns_order(uuid, text, timestamptz) from public;
grant execute on function public.owns_order(uuid, text, timestamptz) to authenticated;

create policy "customer reads own orders"
  on orders for select
  using (public.owns_order(customer_user_id, customer_email, created_at));

create policy "customer reads own order lines"
  on order_lines for select using (
    exists (
      select 1 from orders o
      where o.id = order_lines.order_id
        and public.owns_order(o.customer_user_id, o.customer_email, o.created_at)
    )
  );

create policy "customer reads own order line options"
  on order_line_options for select using (
    exists (
      select 1 from order_lines l
      join orders o on o.id = l.order_id
      where l.id = order_line_options.line_id
        and public.owns_order(o.customer_user_id, o.customer_email, o.created_at)
    )
  );

drop function public.owns_order(uuid, text);

-- 9. Only the API reads and writes these. It may delete here (unlinking, repacking,
-- account deletion, old rate windows), unlike orders, payments, sync_events and shifts.
alter table customers     enable row level security;
alter table stamp_cards   enable row level security;
alter table stamps        enable row level security;
alter table points_ledger enable row level security;
alter table rate_limits   enable row level security;

revoke all on customers, stamp_cards, stamps, points_ledger, rate_limits from anon, authenticated;

grant select, insert, update, delete on customers, stamp_cards, stamps, points_ledger, rate_limits to kennko_api;

create policy "api reads customers" on customers for select to kennko_api using (true);
create policy "api inserts customers" on customers for insert to kennko_api with check (true);
create policy "api updates customers" on customers for update to kennko_api using (true) with check (true);
create policy "api deletes customers" on customers for delete to kennko_api using (true);
create policy "api reads stamp_cards" on stamp_cards for select to kennko_api using (true);
create policy "api inserts stamp_cards" on stamp_cards for insert to kennko_api with check (true);
create policy "api updates stamp_cards" on stamp_cards for update to kennko_api using (true) with check (true);
create policy "api deletes stamp_cards" on stamp_cards for delete to kennko_api using (true);
create policy "api reads stamps" on stamps for select to kennko_api using (true);
create policy "api inserts stamps" on stamps for insert to kennko_api with check (true);
create policy "api updates stamps" on stamps for update to kennko_api using (true) with check (true);
create policy "api deletes stamps" on stamps for delete to kennko_api using (true);
create policy "api reads points_ledger" on points_ledger for select to kennko_api using (true);
create policy "api inserts points_ledger" on points_ledger for insert to kennko_api with check (true);
create policy "api updates points_ledger" on points_ledger for update to kennko_api using (true) with check (true);
create policy "api deletes points_ledger" on points_ledger for delete to kennko_api using (true);
create policy "api reads rate_limits" on rate_limits for select to kennko_api using (true);
create policy "api inserts rate_limits" on rate_limits for insert to kennko_api with check (true);
create policy "api updates rate_limits" on rate_limits for update to kennko_api using (true) with check (true);
create policy "api deletes rate_limits" on rate_limits for delete to kennko_api using (true);
