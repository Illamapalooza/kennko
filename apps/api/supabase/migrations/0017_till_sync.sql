-- Till sync: shifts and cash moves from the till, counter columns on orders and
-- payments, a receipt for every pushed event, and the API's sold-out toggle.
--
-- Ids of till-made rows (shifts, cash moves, counter orders) are generated on
-- the till, so these tables have no id default. There are no counter orders
-- yet, so the new order checks validate against online rows only.

-- 1. Shifts. One open shift per till.
create table shifts (
  id                     uuid primary key,
  device_id              uuid not null references devices(id),
  opened_at              timestamptz not null,
  opened_by_staff        uuid references staff(id),
  opening_float_centavos int not null check (opening_float_centavos >= 0),
  closed_at              timestamptz,
  closed_by_staff        uuid references staff(id),
  counted_centavos       int check (counted_centavos >= 0),
  -- float - cash out can go below zero, so no >= 0 check here.
  expected_centavos      int,
  note                   text not null default '' check (char_length(note) <= 200),
  is_legacy              boolean not null default false,
  received_at            timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint shifts_closed_has_count check ((closed_at is null) = (counted_centavos is null))
);

create unique index shifts_one_open on shifts (device_id) where closed_at is null;

-- 2. Cash in and out of the drawer during a shift.
create table cash_moves (
  id              uuid primary key,
  shift_id        uuid not null references shifts(id),
  kind            text not null check (kind in ('in', 'out')),
  amount_centavos int not null check (amount_centavos > 0),
  reason          text not null check (char_length(reason) between 1 and 80),
  at              timestamptz not null,
  staff_id        uuid references staff(id),
  received_at     timestamptz not null default now()
);

create index cash_moves_shift_idx on cash_moves (shift_id);

-- 3. Counter columns. Every counter order comes from a till; shift and staff
-- belong to the counter only.
alter table orders
  add column device_id       uuid references devices(id),
  add column shift_id        uuid references shifts(id),
  add column opened_by_staff uuid references staff(id);

alter table orders add constraint orders_counter_device check ((channel = 'counter') = (device_id is not null));
alter table orders add constraint orders_counter_only check (
  channel = 'counter' or (shift_id is null and opened_by_staff is null)
);

-- C numbers restart per till and may repeat after a reset, so this is not unique.
create index orders_counter_ticket_idx on orders (device_id, business_day, ticket_number) where ticket_series = 'C';
create index orders_flagged_idx on orders (business_day) where flags <> '{}';

alter table payments add column device_id uuid references devices(id);

-- 4. The receipt for every pushed event, keyed (device_id, id). Legacy import rows the API
-- cannot store are kept here too, as held `invalid: legacy: …` (kinds `import.*`). Shift, cash and
-- sold-out events have no order, and a held event may name an order that does
-- not exist yet, so order_events cannot be the only record.
create table sync_events (
  device_id   uuid not null references devices(id),
  id          uuid not null,
  seq         bigint not null,
  kind        text not null check (kind in (
                'order.created', 'order.prep_status', 'order.cancelled',
                'shift.opened', 'shift.closed', 'cash.moved', 'menu.availability',
                'import.shift', 'import.order', 'import.cash_move'
              )),
  payload     jsonb not null,
  staff_id    uuid,
  entity_keys text[] not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null,
  result      text not null check (result in ('applied', 'flagged', 'held')),
  reason      text,
  applied_at  timestamptz,
  primary key (device_id, id)
);

create index sync_events_held on sync_events (device_id, seq) where result = 'held';

-- 5. Only the API reads and writes these.
alter table shifts      enable row level security;
alter table cash_moves  enable row level security;
alter table sync_events enable row level security;

revoke all on shifts, cash_moves, sync_events from anon, authenticated;

grant select, insert, update on shifts, cash_moves, sync_events to kennko_api;

create policy "api reads shifts" on shifts for select to kennko_api using (true);
create policy "api inserts shifts" on shifts for insert to kennko_api with check (true);
create policy "api updates shifts" on shifts for update to kennko_api using (true) with check (true);
create policy "api reads cash_moves" on cash_moves for select to kennko_api using (true);
create policy "api inserts cash_moves" on cash_moves for insert to kennko_api with check (true);
create policy "api updates cash_moves" on cash_moves for update to kennko_api using (true) with check (true);
create policy "api reads sync_events" on sync_events for select to kennko_api using (true);
create policy "api inserts sync_events" on sync_events for insert to kennko_api with check (true);
create policy "api updates sync_events" on sync_events for update to kennko_api using (true) with check (true);

-- 6. Sold-out from the till. The column grant is what limits this; the stamp
-- trigger from 0012 sets availability_changed_at.
grant update (is_available) on menu_items to kennko_api;
create policy "api updates menu_items availability" on menu_items
  for update to kennko_api using (true) with check (true);
