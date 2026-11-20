-- Shop settings (one row, used on e-receipts) and Web Push subscriptions.
-- The website reads shop_settings with its service key; push rows are written
-- by the API only.

create table shop_settings (
  id              smallint primary key default 1 check (id = 1),
  display_name    text not null,
  registered_name text,
  tin             text,
  address         text not null,
  phone           text,
  facebook_url    text,
  receipt_footer  text not null default 'Ask for your official receipt at the counter.',
  updated_at      timestamptz not null default now()
);

-- Address, phone and Facebook page as the public site shows them. The registered
-- business name and TIN stay empty until the owner supplies them.
insert into shop_settings (display_name, registered_name, tin, address, phone, facebook_url)
values (
  'Kennko Coffee', null, null,
  'CT. Montalban St., Villa Kananga, Butuan City, Philippines 8600',
  '0930 599 2729',
  'https://www.facebook.com/kennco.cafebxu'
);

create table push_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  endpoint         text not null unique,
  p256dh           text not null,
  auth             text not null,
  kind             text not null check (kind in ('customer', 'staff')),
  staff_id         uuid references staff(id) on delete cascade,
  customer_user_id uuid references auth.users(id) on delete cascade,
  check ((kind = 'staff') = (staff_id is not null)),
  created_at       timestamptz not null default now(),
  last_used_at     timestamptz
);

create table push_order_watch (
  order_id        uuid not null references orders(id) on delete cascade,
  subscription_id uuid not null references push_subscriptions(id) on delete cascade,
  primary key (order_id, subscription_id)
);
create index push_order_watch_subscription_idx on push_order_watch (subscription_id);
create index push_subscriptions_staff_idx on push_subscriptions (staff_id) where staff_id is not null;
create index push_subscriptions_customer_idx on push_subscriptions (customer_user_id) where customer_user_id is not null;

alter table shop_settings      enable row level security;
alter table push_subscriptions enable row level security;
alter table push_order_watch   enable row level security;

revoke all on shop_settings, push_subscriptions, push_order_watch from anon, authenticated;
grant select on shop_settings to authenticated;

create policy "staff read shop settings" on shop_settings for select using (public.is_active_staff());

grant select on shop_settings to kennko_api;
grant select, insert, update, delete on push_subscriptions, push_order_watch to kennko_api;

create policy "api reads shop_settings" on shop_settings for select to kennko_api using (true);
create policy "api manages push_subscriptions" on push_subscriptions
  for all to kennko_api using (true) with check (true);
create policy "api manages push_order_watch" on push_order_watch
  for all to kennko_api using (true) with check (true);
