import { haversineKm, type LatLng } from './distance'

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
