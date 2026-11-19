export type SeedZone = {
  barangay: string
  /** APPROXIMATE barangay centre — verify against the map before going live. */
  lat: number
  lng: number
  isHome?: boolean
}

/**
 * Butuan City barangays Kennko delivers to, with approximate centres. Fees are
 * NOT stored: they are computed from these coordinates by the P20-per-4km rule
 * in packages/core/src/delivery.ts, so changing the rule reprices everywhere at once.
 *
 * The coordinates are estimates. A wrong one charges the wrong fee, so verify
 * each against the map before relying on it.
 *
 * A barangay absent from this list is outside the service area.
 */
export const SEED_ZONES: SeedZone[] = [
  { barangay: 'Villa Kananga',  lat: 8.926897, lng: 125.532174, isHome: true },
  { barangay: 'Baan Km. 3',     lat: 8.933,    lng: 125.539 },
  { barangay: 'Golden Ribbon',  lat: 8.945,    lng: 125.539 },
  { barangay: 'Obrero',         lat: 8.948,    lng: 125.543 },
  { barangay: 'Doongan',        lat: 8.956,    lng: 125.548 },
  { barangay: 'Libertad',       lat: 8.942,    lng: 125.529 },
  { barangay: 'J.P. Rizal',     lat: 8.949,    lng: 125.541 },
  { barangay: 'Holy Redeemer',  lat: 8.939,    lng: 125.535 },
  { barangay: 'Imadejas',       lat: 8.935,    lng: 125.525 },
  { barangay: 'Bayanihan',      lat: 8.944,    lng: 125.546 },
  { barangay: 'Ampayon',        lat: 8.957,    lng: 125.601 },
  { barangay: 'Buhangin',       lat: 8.964,    lng: 125.560 },
  { barangay: 'Bancasi',        lat: 8.9515,   lng: 125.4779 },
  { barangay: 'Baan Riverside', lat: 8.940,    lng: 125.545 },
]
