-- Custom barista/owner cat sprites on staff rows, plus live on-duty baristas for the public /cafe wall.

alter table staff
  add column cat_look jsonb;

grant select (cat_look) on staff to authenticated;

alter table shop_settings
  add column active_baristas jsonb not null default '[]'::jsonb;

grant update (active_baristas) on shop_settings to kennko_api;
