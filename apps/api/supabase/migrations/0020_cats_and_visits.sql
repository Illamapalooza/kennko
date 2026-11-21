-- Kennko cats, cosmetics and the wall check-in (Plan 8).
--   cosmetics           the catalogue; keys are the art's keys in @kennko/cats, so admin can rename,
--                       reprice or switch an item off but never add one
--   customer_cosmetics  items a customer bought (starters are owned by everyone and have no row)
--   cats                one per customer: name, what it wears, whether it shows on the wall
--   visits              one per customer: the current or last wall visit
--   shop_secrets        the single check-in secret; the API creates it lazily, so no row here
-- plus the points ledger's cosmetic link, and a starter cat for every existing customer.
--
-- Safe on the live database: additive only, and existing rows pass every new check. Plan 7 writes no
-- 'cosmetic' ledger rows, so the new foreign key and the cosmetic_id check hold for every existing row.

-- 1. The catalogue. A starter is always free.
create table if not exists cosmetics (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique check (key ~ '^[a-z][a-z-]{1,39}$'),
  slot         text not null check (slot in ('coat', 'hat', 'face', 'neck', 'held')),
  name         text not null check (char_length(name) between 1 and 40),
  price_points int not null check (price_points >= 0),
  is_starter   boolean not null default false,
  is_active    boolean not null default true,
  sort_order   int not null default 0,
  check (not is_starter or price_points = 0)
);

-- The starter catalogue (Ruling 3). Points, never pesos.
insert into cosmetics (key, slot, name, price_points, is_starter, sort_order) values
  ('ginger',        'coat', 'Ginger',        0,   true,  1),
  ('tabby',         'coat', 'Tabby',         0,   true,  2),
  ('black',         'coat', 'Black',         0,   true,  3),
  ('cream',         'coat', 'Cream',         0,   true,  4),
  ('tuxedo',        'coat', 'Tuxedo',        60,  false, 5),
  ('white',         'coat', 'White',         60,  false, 6),
  ('calico',        'coat', 'Calico',        90,  false, 7),
  ('siamese',       'coat', 'Siamese',       120, false, 8),
  ('beanie',        'hat',  'Beanie',        40,  false, 9),
  ('party-hat',     'hat',  'Party hat',     50,  false, 10),
  ('visor',         'hat',  'Barista visor', 60,  false, 11),
  ('flower-crown',  'hat',  'Flower crown',  80,  false, 12),
  ('crown',         'hat',  'Crown',         150, false, 13),
  ('blush',         'face', 'Blush',         30,  false, 14),
  ('round-glasses', 'face', 'Round glasses', 40,  false, 15),
  ('sunnies',       'face', 'Sunnies',       60,  false, 16),
  ('bandana',       'neck', 'Bandana',       30,  false, 17),
  ('bow-tie',       'neck', 'Bow tie',       40,  false, 18),
  ('bell-collar',   'neck', 'Bell collar',   50,  false, 19),
  ('kennko-cup',    'held', 'Kennko cup',    30,  false, 20),
  ('croissant',     'held', 'Croissant',     40,  false, 21),
  ('fish',          'held', 'Fish',          50,  false, 22)
on conflict (key) do nothing;

-- 2. Bought items. Cosmetics are never deleted (only switched off), so there is no cascade from them.
create table if not exists customer_cosmetics (
  customer_id uuid references customers(id) on delete cascade,
  cosmetic_id uuid references cosmetics(id),
  acquired_at timestamptz not null,
  primary key (customer_id, cosmetic_id)
);

-- 3. Cats. The coat is always equipped; the other slots may be empty.
create table if not exists cats (
  customer_id     uuid primary key references customers(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 16),
  equipped        jsonb not null check (jsonb_typeof(equipped) = 'object' and equipped ? 'coat'),
  show_on_wall    boolean not null default true,
  hidden_by_admin boolean not null default false,
  hidden_by       uuid references staff(id),
  hidden_at       timestamptz,
  updated_at      timestamptz not null
);

-- 4. Visits. visit_key is new for each visit and identifies nothing outside it.
create table if not exists visits (
  customer_id uuid primary key references customers(id) on delete cascade,
  visit_key   uuid not null,
  source      text not null check (source in ('checkin', 'counter')),
  started_at  timestamptz not null,
  ends_at     timestamptz not null,
  check (ends_at > started_at)
);

create index if not exists visits_active_idx on visits (ends_at);

-- 5. The check-in secret: at most one row. The API inserts it on the first pull that needs it
-- (insert ... on conflict do nothing), so this migration needs no pgcrypto.
create table if not exists shop_secrets (
  id             int primary key check (id = 1),
  checkin_secret text not null check (char_length(checkin_secret) >= 40),
  rotated_at     timestamptz not null
);

-- 6. The points ledger's cosmetic link (Plan 7 left cosmetic_id without a foreign key).
-- A purchase is charged once per customer and cosmetic, as a second guard behind the API's check.
alter table points_ledger
  add constraint points_ledger_cosmetic_fk foreign key (cosmetic_id) references cosmetics(id);
alter table points_ledger
  add constraint points_ledger_cosmetic_needs_id check (reason <> 'cosmetic' or cosmetic_id is not null);
create unique index if not exists points_once_per_cosmetic on points_ledger (customer_id, cosmetic_id)
  where reason = 'cosmetic';

-- 7. A starter cat for every existing customer (Plan 7 ruling). The name and coat are picked from the
-- public code, so the pick is stable; on conflict keeps any cat already there.
insert into cats (customer_id, name, equipped, updated_at)
select
  id,
  (array['Mochi', 'Kape', 'Biko', 'Ube', 'Turon', 'Latte', 'Mango', 'Puto'])
    [1 + mod(hashtext(public_code)::bigint + 2147483648, 8)::int],
  jsonb_build_object('coat', (array['ginger', 'tabby', 'black', 'cream'])
    [1 + mod(hashtext(public_code || 'coat')::bigint + 2147483648, 4)::int]),
  now()
from customers
on conflict do nothing;

-- 8. Only the API reads and writes these. It never deletes here: account deletion removes rows by
-- cascade from customers, and cosmetics are switched off, not deleted.
alter table cosmetics          enable row level security;
alter table customer_cosmetics enable row level security;
alter table cats               enable row level security;
alter table visits             enable row level security;
alter table shop_secrets       enable row level security;

revoke all on cosmetics, customer_cosmetics, cats, visits, shop_secrets from anon, authenticated;

grant select, update         on cosmetics          to kennko_api;
grant select, insert         on customer_cosmetics to kennko_api;
grant select, insert, update on cats               to kennko_api;
grant select, insert, update on visits             to kennko_api;
grant select, insert         on shop_secrets       to kennko_api;

create policy "api reads cosmetics" on cosmetics for select to kennko_api using (true);
create policy "api updates cosmetics" on cosmetics for update to kennko_api using (true) with check (true);
create policy "api reads customer_cosmetics" on customer_cosmetics for select to kennko_api using (true);
create policy "api inserts customer_cosmetics" on customer_cosmetics for insert to kennko_api with check (true);
create policy "api reads cats" on cats for select to kennko_api using (true);
create policy "api inserts cats" on cats for insert to kennko_api with check (true);
create policy "api updates cats" on cats for update to kennko_api using (true) with check (true);
create policy "api reads visits" on visits for select to kennko_api using (true);
create policy "api inserts visits" on visits for insert to kennko_api with check (true);
create policy "api updates visits" on visits for update to kennko_api using (true) with check (true);
create policy "api reads shop_secrets" on shop_secrets for select to kennko_api using (true);
create policy "api inserts shop_secrets" on shop_secrets for insert to kennko_api with check (true);
