create type drink_size as enum ('M', 'L', 'XL', 'HOT');

create table menu_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort_order int  not null default 0,
  is_active  boolean not null default true
);

create table menu_items (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid not null references menu_categories(id) on delete restrict,
  name          text not null,
  description   text,
  image_path    text,
  is_bestseller boolean not null default false,
  is_available  boolean not null default true,
  sort_order    int not null default 0,
  updated_at    timestamptz not null default now(),
  unique (category_id, name)
);

-- A missing row means that size is not offered: strawberry milk has no HOT,
-- hojicha has no XL.
create table menu_item_prices (
  menu_item_id   uuid not null references menu_items(id) on delete cascade,
  size           drink_size not null,
  price_centavos int not null check (price_centavos >= 0),
  primary key (menu_item_id, size)
);

create table modifier_groups (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  is_multi_select boolean not null,
  sort_order      int not null default 0
);

create table modifiers (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references modifier_groups(id) on delete cascade,
  name           text not null,
  price_centavos int not null check (price_centavos >= 0),
  is_available   boolean not null default true,
  sort_order     int not null default 0,
  unique (group_id, name)
);

create index menu_items_category_idx on menu_items (category_id, sort_order);

-- RLS: the public may read the live menu and nothing else. No write policies
-- exist yet, so every write is denied for anon and authenticated alike until
-- Plan 2 adds owner-scoped policies.
alter table menu_categories  enable row level security;
alter table menu_items       enable row level security;
alter table menu_item_prices enable row level security;
alter table modifier_groups  enable row level security;
alter table modifiers        enable row level security;

create policy "public reads active categories"
  on menu_categories for select using (is_active);

-- Deliberately not filtered by is_available: the spec requires unavailable
-- items to render greyed out rather than disappear, so the client must see them.
create policy "public reads items in active categories"
  on menu_items for select using (
    exists (
      select 1 from menu_categories c
      where c.id = menu_items.category_id and c.is_active
    )
  );

create policy "public reads prices of visible items"
  on menu_item_prices for select using (
    exists (
      select 1 from menu_items i
      join menu_categories c on c.id = i.category_id
      where i.id = menu_item_prices.menu_item_id and c.is_active
    )
  );

create policy "public reads modifier groups"
  on modifier_groups for select using (true);

create policy "public reads available modifiers"
  on modifiers for select using (is_available);
