export type SeedZone = { barangay: string; feeCentavos: number }

/**
 * Butuan City barangays, tiered by rough distance from Villa Kananga.
 * Starter values -- the owner adjusts them in /admin/zones. A barangay absent
 * from this list is outside the service area until Kenn adds it.
 */
export const SEED_ZONES: SeedZone[] = [
  // Nearby
  { barangay: 'Villa Kananga', feeCentavos: 3000 },
  { barangay: 'Baan Km. 3', feeCentavos: 3000 },
  { barangay: 'Golden Ribbon', feeCentavos: 3000 },
  { barangay: 'Obrero', feeCentavos: 3000 },
  // Mid
  { barangay: 'Doongan', feeCentavos: 5000 },
  { barangay: 'Libertad', feeCentavos: 5000 },
  { barangay: 'J.P. Rizal', feeCentavos: 5000 },
  { barangay: 'Holy Redeemer', feeCentavos: 5000 },
  { barangay: 'Imadejas', feeCentavos: 5000 },
  { barangay: 'Bayanihan', feeCentavos: 5000 },
  // Farther
  { barangay: 'Ampayon', feeCentavos: 8000 },
  { barangay: 'Buhangin', feeCentavos: 8000 },
  { barangay: 'Bancasi', feeCentavos: 8000 },
  { barangay: 'Baan Riverside', feeCentavos: 8000 },
]
