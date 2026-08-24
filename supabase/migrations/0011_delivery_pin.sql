-- Customer's shared location. Two jobs: it prices the delivery, and it gives
-- the rider something to navigate to when the written address is informal
-- ("green gate beside the sari-sari store").
alter table orders
  add column delivery_lat numeric(9, 6),
  add column delivery_lng numeric(9, 6),
  add column delivery_accuracy_m int check (delivery_accuracy_m >= 0),
  add column delivery_distance_km numeric(6, 2) check (delivery_distance_km >= 0);

-- A pin is a pair or it is nothing; half a coordinate points nowhere.
alter table orders add constraint orders_pin_is_a_pair check (
  (delivery_lat is null and delivery_lng is null)
  or (delivery_lat is not null and delivery_lng is not null)
);

-- Only a delivery has somewhere to go.
alter table orders add constraint orders_pin_only_for_delivery check (
  fulfilment = 'delivery' or (delivery_lat is null and delivery_lng is null)
);
