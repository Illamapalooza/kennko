-- Per-drink preparation note ("less sweet", "extra hot"). Distinct from
-- orders.customer_note, which is about the order as a whole: a barista making
-- the third of five drinks needs the instruction attached to that cup.
alter table order_items add column item_note text;

alter table order_items add constraint order_items_note_length
  check (item_note is null or char_length(item_note) <= 200);
