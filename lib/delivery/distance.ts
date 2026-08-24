export type LatLng = { lat: number; lng: number }

/** Kennko, CT. Montalban St., Villa Kananga — the pin on the site. */
export const CAFE_ORIGIN: LatLng = { lat: 8.9268972, lng: 125.5321737 }

/** ₱20 per 4km band, charged per started band. Free inside the home barangay. */
export const KM_PER_BAND = 4
export const BAND_FEE_CENTAVOS = 2000

const EARTH_RADIUS_KM = 6371

/**
 * Straight-line ("as the crow flies") distance. Roads are longer, so callers
 * apply ROAD_FACTOR rather than charging the raw great-circle figure.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

/**
 * Riders follow streets, not straight lines. 1.3 is the usual rule of thumb for
 * a gridded town; without it every fee is systematically under-charged.
 */
export const ROAD_FACTOR = 1.3

export function ridingDistanceKm(destination: LatLng, origin: LatLng = CAFE_ORIGIN): number {
  return haversineKm(origin, destination) * ROAD_FACTOR
}

/**
 * ₱0 inside the home barangay; otherwise ₱20 for each started 4km band, so any
 * delivery beyond Villa Kananga costs at least one band.
 */
export function deliveryFeeCentavos(distanceKm: number, isHomeZone: boolean): number {
  if (isHomeZone) return 0
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new Error('distance must be a non-negative number')
  }
  const bands = Math.max(1, Math.ceil(distanceKm / KM_PER_BAND))
  return bands * BAND_FEE_CENTAVOS
}

export function describeFee(distanceKm: number, isHomeZone: boolean): string {
  if (isHomeZone) return 'Free — you are in our barangay'
  const bands = Math.max(1, Math.ceil(distanceKm / KM_PER_BAND))
  return `${distanceKm.toFixed(1)}km · ${bands} × ₱20`
}
