'use client'

import { useState } from 'react'

export type SharedPin = { lat: number; lng: number; accuracyM: number | null }

/**
 * Browser geolocation, no map and no tiles. One tap, no dependency, no API
 * key, and the coordinate is what the rider actually needs to find the house.
 */
export function LocationPin({
  pin,
  onPin,
  onClear,
}: {
  pin: SharedPin | null
  onPin: (pin: SharedPin) => void
  onClear: () => void
}) {
  const [state, setState] = useState<'idle' | 'locating' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  function share() {
    if (!('geolocation' in navigator)) {
      setState('error')
      setMessage('This browser cannot share your location. Your barangay will be used instead.')
      return
    }

    setState('locating')
    setMessage(null)

    navigator.geolocation.getCurrentPosition(
      (position) => {
        onPin({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyM: Number.isFinite(position.coords.accuracy)
            ? Math.round(position.coords.accuracy)
            : null,
        })
        setState('idle')
      },
      (error) => {
        setState('error')
        setMessage(
          error.code === error.PERMISSION_DENIED
            ? 'Location permission was declined. We will price by your barangay instead.'
            : 'We could not get your location. We will price by your barangay instead.',
        )
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    )
  }

  return (
    <div className="pin-box">
      {pin ? (
        <div className="pin-ok">
          <strong>Location shared</strong>
          <span>
            Accurate to about {pin.accuracyM ?? '—'}m. The rider uses this to find you.
          </span>
          <div className="pin-actions">
            <button type="button" onClick={share}>Share again</button>
            <button type="button" onClick={onClear}>Remove</button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="pin-btn"
            onClick={share}
            disabled={state === 'locating'}
          >
            {state === 'locating' ? 'Finding you…' : '📍 Use my current location'}
          </button>
          <p className="pin-hint">
            Optional, but it helps the rider find you and prices the delivery from
            where you actually are. Without it we use your barangay.
          </p>
        </>
      )}

      {message ? <p className="pin-note">{message}</p> : null}
    </div>
  )
}
