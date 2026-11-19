-- One order record for every channel. Today's orders are online-only and mix
-- payment with preparation in one `status`; this reshapes them in place:
--   orders.status            -> prep_status + payment_status (text + check)
--   orders.gcash_* / verified_* -> payments (one row per order)
--   order_items              -> order_lines (variant snapshot instead of size)
--   order_item_modifiers     -> order_line_options (with the group name)
-- plus ticket numbers (W per Manila day for online, C for the till), a
-- ticket counter, and an append-only order_events history.
--
-- Every existing row is an online order. Runs once, inside the push transaction.

-- 1. New order columns, nullable until backfilled.
alter table orders
  add column channel            text not null default 'online',
  add column business_day       date,
  add column ticket_series      text,
  add column ticket_number      int,
  add column prep_status        text,
  add column payment_status     text,
  add column menu_version       bigint references menu_snapshots(version),
  add column discount_centavos  int not null default 0 check (discount_centavos >= 0),
  add column discount_label     text,
  add column discount_kind      text check (discount_kind in ('percent', 'amount')),
  add column discount_value     int,
  add column flags              text[] not null default '{}',
  add column received_at        timestamptz not null default now(),
  add column updated_at         timestamptz not null default now(),
  add column cancelled_at       timestamptz,
  add column cancelled_by_staff uuid references staff(id),
  add column cancel_reason      text;

alter table order_items
  add column variant_id    uuid references menu_variants(id) on delete set null,
  add column variant_code  text,
  add column variant_label text;

alter table order_item_modifiers add column group_name text;

-- 2. Backfill orders.
update orders set
  business_day   = (created_at at time zone 'Asia/Manila')::date,
  ticket_series  = 'W',
  received_at    = created_at,
  prep_status    = case status::text
                     when 'awaiting_verification' then 'placed'
                     when 'confirmed'             then 'placed'
                     when 'rejected'              then 'cancelled'
                     when 'cancelled'             then 'cancelled'
                     else status::text
                   end,
  payment_status = case status::text
                     when 'awaiting_verification' then 'pending_verification'
                     when 'rejected'              then 'rejected'
                     when 'cancelled'             then case when verified_at is not null then 'refunded' else 'rejected' end
                     else 'paid'
                   end;

update orders o set ticket_number = n.rn
from (
  select id, row_number() over (partition by business_day order by created_at, id) as rn
  from orders
) n
where n.id = o.id;

alter table orders
  alter column business_day   set not null,
  alter column ticket_series  set not null,
  alter column ticket_number  set not null,
  alter column prep_status    set not null,
  alter column payment_status set not null;

-- 3. Backfill lines and options.
update order_items i set
  variant_code  = i.size::text,
  variant_label = case i.size::text when 'M' then 'Medium' when 'L' then 'Large' when 'XL' then 'XL' else 'Hot' end,
  variant_id    = (select v.id from menu_variants v where v.item_id = i.menu_item_id and v.code = i.size::text);

alter table order_items
  alter column variant_code  set not null,
  alter column variant_label set not null;

update order_item_modifiers m set group_name = coalesce(
  (select g.name from options o join option_groups g on g.id = o.group_id where o.id = m.modifier_id),
  ''
);

alter table order_item_modifiers alter column group_name set not null;

-- 4. Constraints. Checks that compare `fulfilment` with the old enum go first,
-- so the column can become text.
alter table orders drop constraint orders_delivery_needs_address;
alter table orders drop constraint orders_pin_only_for_delivery;
alter table orders drop constraint orders_total_is_subtotal_plus_fee;
alter table order_items drop constraint order_items_ice_matches_size;

alter table orders alter column fulfilment type text using fulfilment::text;

alter table orders
  alter column order_code     drop not null,
  alter column customer_phone drop not null,
  alter column customer_email drop not null,
  alter column fulfil_at      drop not null;

alter table orders add constraint orders_channel_fulfilment check (
  (channel = 'counter' and fulfilment in ('dine_in', 'takeout'))
  or (channel = 'online' and fulfilment in ('pickup', 'delivery'))
);
alter table orders add constraint orders_ticket_series_check check (ticket_series in ('C', 'W'));
alter table orders add constraint orders_ticket_series_channel check ((channel = 'online') = (ticket_series = 'W'));
alter table orders add constraint orders_ticket_number_check check (ticket_number > 0);
alter table orders add constraint orders_prep_status_check check (
  prep_status in ('placed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled')
);
alter table orders add constraint orders_payment_status_check check (
  payment_status in ('unpaid', 'pending_verification', 'paid', 'rejected', 'refunded')
);
alter table orders add constraint orders_online_contact check (
  channel = 'counter'
  or (order_code is not null and customer_phone is not null
      and customer_email is not null and fulfil_at is not null)
);
alter table orders add constraint orders_discount_le_subtotal check (discount_centavos <= subtotal_centavos);
alter table orders add constraint orders_total_math check (
  total_centavos = subtotal_centavos - discount_centavos + delivery_fee_centavos
);
alter table orders add constraint orders_delivery_needs_address check (
  (fulfilment = 'delivery'
     and delivery_address is not null and delivery_barangay is not null
     and delivery_zone_id is not null)
  or
  (fulfilment <> 'delivery'
     and delivery_address is null and delivery_barangay is null
     and delivery_zone_id is null and delivery_fee_centavos = 0)
);
alter table orders add constraint orders_pin_only_for_delivery check (
  fulfilment = 'delivery' or (delivery_lat is null and delivery_lng is null)
);

alter table order_items add constraint order_lines_ice_shape check (
  (ice_level is null and ice_serve is null)
  or (ice_level = 'none' and ice_serve is null)
  or (ice_level <> 'none' and ice_serve is not null)
);

create unique index orders_w_ticket_unique on orders (business_day, ticket_number) where ticket_series = 'W';
create index orders_prep_created_idx on orders (prep_status, created_at desc);
create index orders_payment_idx on orders (payment_status);

-- 5. Ticket counters: W numbers come from an upsert ... returning, never max()+1.
create table ticket_counters (
  business_day date not null,
  series       text not null check (series in ('C', 'W')),
  last_number  int not null,
  primary key (business_day, series)
);

insert into ticket_counters (business_day, series, last_number)
select business_day, ticket_series, max(ticket_number)
from orders
group by business_day, ticket_series;

-- 6. Payments, from the old columns. A refund is a status change, not a second row.
create table payments (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete cascade,
  method            text not null check (method in ('cash', 'gcash')),
  amount_centavos   int not null check (amount_centavos >= 0),
  tendered_centavos int,
  change_centavos   int,
  check (method <> 'cash' or tendered_centavos - change_centavos = amount_centavos),
  reference         text,
  proof_path        text,
  status            text not null
                    check (status in ('recorded', 'pending_verification', 'verified', 'rejected', 'refunded')),
  verified_by       uuid references staff(id),
  verified_at       timestamptz,
  recorded_at       timestamptz not null default now()
);
create unique index payments_one_live on payments (order_id) where status <> 'rejected';
create index payments_reference_idx on payments (reference);

insert into payments (order_id, method, amount_centavos, reference, proof_path, status,
                      verified_by, verified_at, recorded_at)
select id, 'gcash', total_centavos, gcash_reference, payment_proof_path,
       case payment_status when 'paid' then 'verified' else payment_status end,
       verified_by, verified_at, created_at
from orders;

-- 7. Order history. Also the idempotency record for till pushes.
create table order_events (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid,
  order_id    uuid not null references orders(id) on delete cascade,
  kind        text not null check (kind in ('created', 'prep_status', 'payment', 'cancelled', 'note')),
  from_value  text,
  to_value    text,
  staff_id    uuid references staff(id),
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  result      text not null default 'applied' check (result in ('applied', 'flagged', 'held')),
  reason      text,
  unique (device_id, id)
);

insert into order_events (order_id, kind, to_value, occurred_at, received_at)
select id, 'created', prep_status, created_at, created_at
from orders;

-- 8. Drop what moved. Dropping `status` drops orders_status_created_idx.
drop index orders_gcash_reference_idx;
alter table orders
  drop column status,
  drop column gcash_reference,
  drop column payment_proof_path,
  drop column verified_by,
  drop column verified_at;
alter table order_items drop column size;

drop type order_status;
drop type fulfilment_method;
drop type drink_size;

-- 9. Renames. Policies, foreign keys and checks follow the table and column.
alter table order_items rename to order_lines;
alter table order_lines rename column menu_item_id to item_id;
alter table order_lines rename column name_snapshot to item_name;
alter table order_lines rename column base_price_centavos to unit_price_centavos;
alter table order_lines rename column item_note to note;
alter table order_lines rename constraint order_items_note_length to order_lines_note_length;
create index order_lines_order_idx on order_lines (order_id);

alter table order_item_modifiers rename to order_line_options;
alter table order_line_options rename column order_item_id to line_id;
alter table order_line_options rename column modifier_id to option_id;
alter table order_line_options rename column name_snapshot to option_name;

alter policy "staff read order items" on order_lines rename to "staff read order lines";
alter policy "customer reads own order items" on order_lines rename to "customer reads own order lines";
alter policy "staff read order item modifiers" on order_line_options rename to "staff read order line options";
alter policy "customer reads own order item modifiers" on order_line_options
  rename to "customer reads own order line options";

-- 10. Policies. The website stops writing orders; the API writes as kennko_api.
drop policy "staff update orders" on orders;

alter table ticket_counters enable row level security;
alter table payments        enable row level security;
alter table order_events    enable row level security;

-- Supabase's default privileges give anon and authenticated every table
-- privilege, including ones RLS does not govern. Keep only what the staff read
-- policies below need.
revoke all on payments, order_events, ticket_counters from anon, authenticated;
grant select on payments, order_events to authenticated;

-- Customers get no policy on payments or events: proof paths and references stay staff-only.
create policy "staff read payments" on payments for select using (public.is_active_staff());
create policy "staff read order events" on order_events for select using (public.is_active_staff());

grant select, insert, update on orders, order_lines, order_line_options, payments, order_events, ticket_counters
  to kennko_api;
grant select on delivery_zones to kennko_api;

create policy "api reads orders" on orders for select to kennko_api using (true);
create policy "api inserts orders" on orders for insert to kennko_api with check (true);
create policy "api updates orders" on orders for update to kennko_api using (true) with check (true);
create policy "api reads order_lines" on order_lines for select to kennko_api using (true);
create policy "api inserts order_lines" on order_lines for insert to kennko_api with check (true);
create policy "api updates order_lines" on order_lines for update to kennko_api using (true) with check (true);
create policy "api reads order_line_options" on order_line_options for select to kennko_api using (true);
create policy "api inserts order_line_options" on order_line_options for insert to kennko_api with check (true);
create policy "api updates order_line_options" on order_line_options
  for update to kennko_api using (true) with check (true);
create policy "api reads payments" on payments for select to kennko_api using (true);
create policy "api inserts payments" on payments for insert to kennko_api with check (true);
create policy "api updates payments" on payments for update to kennko_api using (true) with check (true);
create policy "api reads order_events" on order_events for select to kennko_api using (true);
create policy "api inserts order_events" on order_events for insert to kennko_api with check (true);
create policy "api updates order_events" on order_events for update to kennko_api using (true) with check (true);
create policy "api reads ticket_counters" on ticket_counters for select to kennko_api using (true);
create policy "api inserts ticket_counters" on ticket_counters for insert to kennko_api with check (true);
create policy "api updates ticket_counters" on ticket_counters
  for update to kennko_api using (true) with check (true);
create policy "api reads delivery_zones" on delivery_zones for select to kennko_api using (true);
