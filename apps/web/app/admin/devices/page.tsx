import { requireOwner } from '@/lib/auth/session'
import { staffFetch } from '@/lib/api/client'
import { AddTill } from '@/components/admin/AddTill'
import { DeviceRow } from '@/components/admin/DeviceRow'
import type { TillView } from '@/lib/admin/tills'

async function loadTills(): Promise<{ devices: TillView[] } | { error: string }> {
  try {
    const res = await staffFetch('/v1/devices')
    if (!res.ok) return { error: "Couldn't load tills. Refresh to try again." }
    const body = (await res.json()) as { devices?: TillView[] }
    return { devices: body.devices ?? [] }
  } catch {
    return { error: "Couldn't reach the server. Refresh to try again." }
  }
}

export default async function DevicesPage() {
  await requireOwner()
  const loaded = await loadTills()
  const devices = 'devices' in loaded ? loaded.devices : []

  return (
    <>
      <h1>Tills</h1>

      <AddTill />

      {'error' in loaded ? (
        <p className="admin-error" role="alert">
          {loaded.error}
        </p>
      ) : null}

      <div className="till-list">
        {devices.map((till) => (
          <DeviceRow key={till.id} till={till} />
        ))}
        {devices.length === 0 && !('error' in loaded) ? <p>No tills yet. Add one above.</p> : null}
      </div>
    </>
  )
}
