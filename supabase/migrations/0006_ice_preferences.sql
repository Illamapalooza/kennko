-- Ice is a preparation instruction, not a priced add-on: it changes what the
-- barista makes, so it lives on the order line rather than in modifiers.
create type ice_level as enum ('regular', 'less', 'none');
create type ice_serve as enum ('mixed', 'side');

alter table order_items
  add column ice_level ice_level,
  add column ice_serve ice_serve;

-- A hot drink has no ice to talk about, and "no ice" has nothing to serve on
-- the side. Both are enforced here so a crafted request cannot produce an
-- instruction a barista cannot act on.
alter table order_items add constraint order_items_ice_matches_size check (
  (size = 'HOT' and ice_level is null and ice_serve is null)
  or
  (size <> 'HOT' and ice_level is not null
     and ((ice_level = 'none' and ice_serve is null)
       or (ice_level <> 'none' and ice_serve is not null)))
);
