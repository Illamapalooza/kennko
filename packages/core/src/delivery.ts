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

/**
 * How far a pin may sit from the centre of the barangay the customer chose.
 * Butuan barangays are a few km across, so 4km accepts an honest pin anywhere
 * inside one while refusing a pin in a different part of the city.
 */
export const MAX_PIN_DRIFT_KM = 4

/** A GPS fix looser than this is too vague to price from. */
export const MAX_ACCURACY_M = 500

export type PinCheck =
  | { ok: true; pin: LatLng }
  | { ok: false; reason: 'inconsistent' | 'inaccurate' | 'malformed'; message: string }

/**
 * The pin is client-supplied and now decides the delivery fee, so it is checked
 * against the barangay -- which is not client-supplied, being looked up
 * server-side. This bounds any manipulation to within one barangay: exactly the
 * granularity the fee had before pins existed, so a liar gains nothing.
 */
export function verifyPin(
  pin: { lat: number; lng: number; accuracyM?: number | null } | null,
  barangayCentre: LatLng,
): PinCheck {
  if (!pin) return { ok: false, reason: 'malformed', message: 'No location was shared.' }

  const { lat, lng, accuracyM } = pin

  if (
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    lat < -90 || lat > 90 || lng < -180 || lng > 180
  ) {
    return { ok: false, reason: 'malformed', message: 'That location is not a valid point.' }
  }

  if (accuracyM != null && Number.isFinite(accuracyM) && accuracyM > MAX_ACCURACY_M) {
    return {
      ok: false,
      reason: 'inaccurate',
      message:
        'Your phone could not pin your location precisely. Move outside or try ' +
        'again, and we will use your barangay in the meantime.',
    }
  }

  const drift = haversineKm(barangayCentre, { lat, lng })
  if (drift > MAX_PIN_DRIFT_KM) {
    return {
      ok: false,
      reason: 'inconsistent',
      message:
        'Your pinned location is not in the barangay you chose. Check the ' +
        'barangay, or share your location again.',
    }
  }

  return { ok: true, pin: { lat, lng } }
}
