-- Shop open/close flag and automatic closing time (Asia/Manila, default 23:00).
-- Opens at 10:00 AM weekdays and 3:00 PM weekends; staff/owner can override from POS or Admin.

alter table shop_settings
  add column is_open boolean not null default true,
  add column closing_time text default '23:00',
  add column shop_status_updated_at timestamptz not null default now();

grant update (is_open, closing_time, shop_status_updated_at) on shop_settings to kennko_api;
create policy "api updates shop_settings status"
  on shop_settings for update to kennko_api using (true) with check (true);
