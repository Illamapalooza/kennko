-- Delivery pricing moves from a hand-set flat fee per barangay to a distance
-- rule: free inside Villa Kananga, otherwise P20 per started 4km band measured
-- from the cafe. Coordinates make that computable with no maps API.
alter table delivery_zones
  add column latitude  numeric(9, 6),
  add column longitude numeric(9, 6),
  add column is_home   boolean not null default false,
  add column fee_override_centavos int check (fee_override_centavos >= 0);

comment on column delivery_zones.fee_override_centavos is
  'Set to pin a barangay to a fixed fee, ignoring the distance rule.';
comment on column delivery_zones.latitude is
  'APPROXIMATE barangay centre. Seeded from estimates -- verify against the map before relying on the fees.';

-- Approximate barangay centres. Everyone in a barangay pays the same fee,
-- which is predictable to quote and impossible to argue about.
update delivery_zones set latitude = 8.926897, longitude = 125.532174, is_home = true
  where barangay = 'Villa Kananga';
update delivery_zones set latitude = 8.933000, longitude = 125.539000 where barangay = 'Baan Km. 3';
update delivery_zones set latitude = 8.945000, longitude = 125.539000 where barangay = 'Golden Ribbon';
update delivery_zones set latitude = 8.948000, longitude = 125.543000 where barangay = 'Obrero';
update delivery_zones set latitude = 8.956000, longitude = 125.548000 where barangay = 'Doongan';
update delivery_zones set latitude = 8.942000, longitude = 125.529000 where barangay = 'Libertad';
update delivery_zones set latitude = 8.949000, longitude = 125.541000 where barangay = 'J.P. Rizal';
update delivery_zones set latitude = 8.939000, longitude = 125.535000 where barangay = 'Holy Redeemer';
update delivery_zones set latitude = 8.935000, longitude = 125.525000 where barangay = 'Imadejas';
update delivery_zones set latitude = 8.944000, longitude = 125.546000 where barangay = 'Bayanihan';
update delivery_zones set latitude = 8.957000, longitude = 125.601000 where barangay = 'Ampayon';
update delivery_zones set latitude = 8.964000, longitude = 125.560000 where barangay = 'Buhangin';
update delivery_zones set latitude = 8.951500, longitude = 125.477900 where barangay = 'Bancasi';
update delivery_zones set latitude = 8.940000, longitude = 125.545000 where barangay = 'Baan Riverside';

-- Exactly one barangay is the cafe's own, and it is the free one.
create unique index delivery_zones_single_home
  on delivery_zones (is_home) where is_home;

-- A zone must be locatable, or its fee cannot be computed.
alter table delivery_zones add constraint delivery_zones_needs_coordinates check (
  (latitude is not null and longitude is not null)
  or fee_override_centavos is not null
);
