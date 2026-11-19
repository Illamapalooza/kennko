-- Menu restructure: per-item variants (replacing the fixed size enum), option
-- groups attached per item (replacing global modifier groups), food, discount
-- presets, published menu snapshots, and the role the API connects as.
--
-- menu_item_prices, modifier_groups and modifiers stay in place: the live
-- website reads them until it moves to variants and options.

alter table menu_categories
  add column kind text not null default 'drink' check (kind in ('drink', 'food'));
alter table menu_items add column availability_changed_at timestamptz;

create table menu_variants (
  id                      uuid primary key default gen_random_uuid(),
  item_id                 uuid not null references menu_items(id) on delete restrict,
  code                    text not null check (code ~ '^[A-Z]{1,4}$'),
  label                   text not null,
  price_centavos          int not null check (price_centavos >= 0),
  temperature             text not null check (temperature in ('iced', 'hot', 'none')),
  sort_order              int not null default 0,
  is_archived             boolean not null default false,
  is_available            boolean not null default true,
  availability_changed_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (item_id, code)
);

create table option_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  min_select int not null default 0,
  max_select int not null default 1,
  sort_order int not null default 0,
  check (0 <= min_select and min_select <= max_select)
);

create table options (
  id                      uuid primary key default gen_random_uuid(),
  group_id                uuid not null references option_groups(id) on delete restrict,
  name                    text not null,
  price_centavos          int not null default 0 check (price_centavos >= 0),
  sort_order              int not null default 0,
  is_archived             boolean not null default false,
  is_available            boolean not null default true,
  availability_changed_at timestamptz,
  unique (group_id, name)
);

create table item_option_groups (
  item_id    uuid not null references menu_items(id) on delete cascade,
  group_id   uuid not null references option_groups(id) on delete cascade,
  sort_order int not null default 0,
  primary key (item_id, group_id)
);

create table discount_presets (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  kind       text not null check (kind in ('percent', 'amount')),
  value      int not null check (value > 0 and (kind <> 'percent' or value <= 100)),
  is_active  boolean not null default true,
  sort_order int not null default 0
);

create table menu_snapshots (
  version      bigint primary key,
  body         jsonb not null,
  body_hash    text not null,
  published_at timestamptz not null default now(),
  published_by uuid references staff(id)
);
-- Not unique: an edit back to an older state publishes a new version with an old hash.
create index menu_snapshots_body_hash_idx on menu_snapshots (body_hash);

create table menu_publish_lock (
  id boolean primary key default true check (id)
);
insert into menu_publish_lock (id) values (true);

create index menu_variants_item_idx on menu_variants (item_id, sort_order);
create index options_group_idx on options (group_id, sort_order);

-- 1. Backfill variants from the old per-size prices.
insert into menu_variants (item_id, code, label, price_centavos, temperature, sort_order)
select p.menu_item_id,
       p.size::text,
       case p.size::text when 'M' then 'Medium' when 'L' then 'Large' when 'XL' then 'XL' else 'Hot' end,
       p.price_centavos,
       case when p.size::text = 'HOT' then 'hot' else 'iced' end,
       case p.size::text when 'M' then 0 when 'L' then 1 when 'XL' then 2 else 3 end
from menu_item_prices p;

-- 2. Backfill option groups and options, keeping ids so order history still points at them.
insert into option_groups (id, name, min_select, max_select, sort_order)
select id, name, 0, case when is_multi_select then 5 else 1 end, sort_order
from modifier_groups;

insert into options (id, group_id, name, price_centavos, sort_order, is_available)
select id, group_id, name, price_centavos, sort_order, is_available
from modifiers;

-- 3. Every old group applies to every existing (drink) item.
insert into item_option_groups (item_id, group_id, sort_order)
select i.id, g.id, g.sort_order
from menu_items i cross join option_groups g;

-- 4. Order history now points at options.
alter table order_item_modifiers drop constraint order_item_modifiers_modifier_id_fkey;
alter table order_item_modifiers
  add constraint order_item_modifiers_modifier_id_fkey
  foreign key (modifier_id) references options(id) on delete set null;

-- 5. Food.
insert into menu_categories (name, kind, sort_order)
select 'Food', 'food', coalesce(max(sort_order), 0) + 1 from menu_categories;

insert into menu_items (category_id, name, description, sort_order)
select c.id, v.name, v.description, v.sort_order
from menu_categories c,
     (values ('Cookies', null::text, 0), ('Empanada', 'Chicken', 1), ('Fries', null, 2))
       as v(name, description, sort_order)
where c.name = 'Food';

insert into menu_variants (item_id, code, label, price_centavos, temperature, sort_order)
select i.id, 'REG', 'Regular', v.price, 'none', 0
from menu_items i
join menu_categories c on c.id = i.category_id and c.name = 'Food'
join (values ('Cookies', 6000), ('Empanada', 4500), ('Fries', 8500)) as v(name, price) on v.name = i.name;

insert into option_groups (name, min_select, max_select, sort_order)
values ('Cookie flavour', 1, 1, 100), ('Fries flavour', 1, 1, 101);

insert into options (group_id, name, price_centavos, sort_order)
select g.id, v.name, 0, v.sort_order
from option_groups g
join (values
  ('Cookie flavour', 'Original', 0), ('Cookie flavour', 'Chocolate', 1), ('Cookie flavour', 'Red Velvet', 2),
  ('Fries flavour', 'Original', 0), ('Fries flavour', 'Cheese', 1), ('Fries flavour', 'BBQ', 2),
  ('Fries flavour', 'Sour Cream', 3)
) as v(group_name, name, sort_order) on v.group_name = g.name;

insert into item_option_groups (item_id, group_id, sort_order)
select i.id, g.id, 0
from menu_items i
join option_groups g
  on (i.name = 'Cookies' and g.name = 'Cookie flavour')
  or (i.name = 'Fries' and g.name = 'Fries flavour')
where i.category_id = (select id from menu_categories where name = 'Food');

-- 6. Discount presets.
insert into discount_presets (label, kind, value, sort_order)
values ('Senior / PWD 20%', 'percent', 20, 0), ('Promo 10%', 'percent', 10, 1);

-- Availability changes are timestamped so the till can tell what changed last.
create or replace function public.stamp_availability_changed()
returns trigger
language plpgsql
as $$
begin
  if new.is_available is distinct from old.is_available then
    new.availability_changed_at := now();
  end if;
  return new;
end;
$$;

create trigger stamp_availability_menu_items
  before update on menu_items
  for each row execute function public.stamp_availability_changed();
create trigger stamp_availability_menu_variants
  before update on menu_variants
  for each row execute function public.stamp_availability_changed();
create trigger stamp_availability_options
  before update on options
  for each row execute function public.stamp_availability_changed();

-- Barista guards. availability_changed_at is set by the stamp trigger, so it
-- (and updated_at on variants) is allowed to move; everything else is owner-only.
create or replace function public.guard_menu_item_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_owner() then
    return new;
  end if;

  if new.id            is distinct from old.id
     or new.category_id   is distinct from old.category_id
     or new.name          is distinct from old.name
     or new.description   is distinct from old.description
     or new.image_path    is distinct from old.image_path
     or new.is_bestseller is distinct from old.is_bestseller
     or new.sort_order    is distinct from old.sort_order
     or new.is_archived   is distinct from old.is_archived
  then
    raise exception 'Only an owner may change menu item fields other than availability'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.guard_menu_variant_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_owner() then
    return new;
  end if;

  if new.id             is distinct from old.id
     or new.item_id        is distinct from old.item_id
     or new.code           is distinct from old.code
     or new.label          is distinct from old.label
     or new.price_centavos is distinct from old.price_centavos
     or new.temperature    is distinct from old.temperature
     or new.sort_order     is distinct from old.sort_order
     or new.is_archived    is distinct from old.is_archived
     or new.created_at     is distinct from old.created_at
  then
    raise exception 'Only an owner may change variant fields other than availability'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.guard_option_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_owner() then
    return new;
  end if;

  if new.id             is distinct from old.id
     or new.group_id       is distinct from old.group_id
     or new.name           is distinct from old.name
     or new.price_centavos is distinct from old.price_centavos
     or new.sort_order     is distinct from old.sort_order
     or new.is_archived    is distinct from old.is_archived
  then
    raise exception 'Only an owner may change option fields other than availability'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger guard_menu_variant_columns_trg
  before update on menu_variants
  for each row execute function public.guard_menu_variant_columns();
create trigger guard_option_columns_trg
  before update on options
  for each row execute function public.guard_option_columns();

-- RLS. Nothing sold is hard-deleted, so there are no delete policies on
-- variants, options, option groups or presets: they are archived or deactivated.
alter table menu_variants      enable row level security;
alter table option_groups      enable row level security;
alter table options            enable row level security;
alter table item_option_groups enable row level security;
alter table discount_presets   enable row level security;
alter table menu_snapshots     enable row level security;
alter table menu_publish_lock  enable row level security;

create policy "public reads live variants"
  on menu_variants for select using (
    not is_archived
    and exists (
      select 1 from menu_items i
      join menu_categories c on c.id = i.category_id
      where i.id = menu_variants.item_id and not i.is_archived and c.is_active
    )
  );
create policy "staff read all variants"
  on menu_variants for select using (public.is_active_staff());
create policy "staff update variants"
  on menu_variants for update using (public.is_active_staff());
create policy "owner inserts variants"
  on menu_variants for insert with check (public.is_owner());

create policy "public reads option groups"
  on option_groups for select using (true);
create policy "owner inserts option groups"
  on option_groups for insert with check (public.is_owner());
create policy "owner updates option groups"
  on option_groups for update using (public.is_owner()) with check (public.is_owner());

create policy "public reads live options"
  on options for select using (not is_archived);
create policy "staff read all options"
  on options for select using (public.is_active_staff());
create policy "staff update options"
  on options for update using (public.is_active_staff());
create policy "owner inserts options"
  on options for insert with check (public.is_owner());

create policy "public reads item option groups"
  on item_option_groups for select using (true);
create policy "owner writes item option groups"
  on item_option_groups for all using (public.is_owner()) with check (public.is_owner());

create policy "staff read discount presets"
  on discount_presets for select using (public.is_active_staff());
create policy "owner inserts discount presets"
  on discount_presets for insert with check (public.is_owner());
create policy "owner updates discount presets"
  on discount_presets for update using (public.is_owner()) with check (public.is_owner());

-- The API's database role. The password is set at deploy, never here.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'kennko_api') then
    create role kennko_api nologin;
  end if;
end
$$;

grant usage on schema public to kennko_api;
grant select on
  menu_categories, menu_items, menu_item_prices, modifier_groups, modifiers,
  menu_variants, option_groups, options, item_option_groups,
  discount_presets, menu_snapshots, staff
  to kennko_api;
grant insert on menu_snapshots to kennko_api;
grant select, update on menu_publish_lock to kennko_api;

create policy "api reads menu_categories" on menu_categories for all to kennko_api using (true) with check (true);
create policy "api reads menu_items" on menu_items for all to kennko_api using (true) with check (true);
create policy "api reads menu_item_prices" on menu_item_prices for all to kennko_api using (true) with check (true);
create policy "api reads modifier_groups" on modifier_groups for all to kennko_api using (true) with check (true);
create policy "api reads modifiers" on modifiers for all to kennko_api using (true) with check (true);
create policy "api reads menu_variants" on menu_variants for all to kennko_api using (true) with check (true);
create policy "api reads option_groups" on option_groups for all to kennko_api using (true) with check (true);
create policy "api reads options" on options for all to kennko_api using (true) with check (true);
create policy "api reads item_option_groups" on item_option_groups for all to kennko_api using (true) with check (true);
create policy "api reads discount_presets" on discount_presets for all to kennko_api using (true) with check (true);
create policy "api reads staff" on staff for all to kennko_api using (true) with check (true);
create policy "api writes menu_snapshots" on menu_snapshots for all to kennko_api using (true) with check (true);
create policy "api uses menu_publish_lock" on menu_publish_lock for all to kennko_api using (true) with check (true);
