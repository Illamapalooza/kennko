create type fulfilment_method as enum ('pickup', 'delivery');

create type order_status as enum (
  'awaiting_verification', 'confirmed', 'preparing',
  'ready', 'out_for_delivery', 'completed', 'rejected', 'cancelled'
);

create table delivery_zones (
  id           uuid primary key default gen_random_uuid(),
  barangay     text not null unique,
  fee_centavos int not null check (fee_centavos >= 0),
  is_active    boolean not null default true,
  sort_order   int not null default 0
);

create table orders (
  id                    uuid primary key default gen_random_uuid(),
  order_code            text not null unique,
  customer_name         text not null,
  customer_phone        text not null,
  customer_email        text not null,
  fulfilment            fulfilment_method not null,
  delivery_address      text,
  delivery_barangay     text,
  delivery_zone_id      uuid references delivery_zones(id),
  fulfil_at             timestamptz not null,
  status                order_status not null default 'awaiting_verification',
  subtotal_centavos     int not null check (subtotal_centavos >= 0),
  delivery_fee_centavos int not null default 0 check (delivery_fee_centavos >= 0),
  total_centavos        int not null check (total_centavos >= 0),
  gcash_reference       text not null,
  payment_proof_path    text not null,
  customer_note         text,
  staff_note            text,
  verified_by           uuid references staff(id),
  verified_at           timestamptz,
  created_at            timestamptz not null default now()
);

-- A delivery order without an address is meaningless; a pickup order carrying
-- one means the form is confused. Both rejected at the database, not just in
-- the form, so a crafted request cannot create a delivery going nowhere.
alter table orders add constraint orders_delivery_needs_address check (
  (fulfilment = 'delivery'
     and delivery_address is not null and delivery_barangay is not null
     and delivery_zone_id is not null)
  or
  (fulfilment = 'pickup'
     and delivery_address is null and delivery_barangay is null
     and delivery_zone_id is null and delivery_fee_centavos = 0)
);

alter table orders add constraint orders_total_is_subtotal_plus_fee check (
  total_centavos = subtotal_centavos + delivery_fee_centavos
);

create index orders_status_created_idx on orders (status, created_at desc);
create index orders_gcash_reference_idx on orders (gcash_reference);

create table order_items (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references orders(id) on delete cascade,
  menu_item_id        uuid references menu_items(id) on delete set null,
  name_snapshot       text not null,
  size                drink_size not null,
  base_price_centavos int not null,
  quantity            int not null check (quantity > 0 and quantity <= 20),
  line_total_centavos int not null,
  created_at          timestamptz not null default now()
);

create table order_item_modifiers (
  id             uuid primary key default gen_random_uuid(),
  order_item_id  uuid not null references order_items(id) on delete cascade,
  modifier_id    uuid references modifiers(id) on delete set null,
  name_snapshot  text not null,
  price_centavos int not null
);

alter table delivery_zones       enable row level security;
alter table orders               enable row level security;
alter table order_items          enable row level security;
alter table order_item_modifiers enable row level security;

create policy "public reads active zones"
  on delivery_zones for select using (is_active);
create policy "owner writes zones"
  on delivery_zones for all using (public.is_owner()) with check (public.is_owner());

-- Public may NOT select orders at all. Status lookup goes through a server
-- route keyed on order_code, returning a narrow projection.
create policy "staff read orders"
  on orders for select using (public.is_active_staff());
create policy "staff update orders"
  on orders for update using (public.is_active_staff());
create policy "staff read order items"
  on order_items for select using (public.is_active_staff());
create policy "staff read order item modifiers"
  on order_item_modifiers for select using (public.is_active_staff());

-- Order creation goes through the service role in a server route, which is
-- what enforces server-side pricing. No anon insert policy exists, so a
-- crafted client request cannot write an order directly.

-- Payment proofs: PRIVATE. Staff read via short-lived signed URLs. A public
-- bucket would expose every customer's name and GCash reference.
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do nothing;

create policy "staff read payment proofs"
  on storage.objects for select
  using (bucket_id = 'payment-proofs' and public.is_active_staff());
