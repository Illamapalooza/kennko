-- Remove the legacy menu tables. Run only after the website reads variants and
-- options and one checkout has gone through (0012 repointed
-- order_item_modifiers.modifier_id to options, so nothing references these).
--
-- Dropping a table also drops its policies (0001, 0003, 0012), indexes and
-- grants. The drink_size enum stays: order_items.size still uses it.

drop table menu_item_prices;
drop table modifiers;
drop table modifier_groups;
