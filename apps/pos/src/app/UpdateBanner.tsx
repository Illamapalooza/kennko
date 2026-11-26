import { useEffect, useState } from 'react'
import { getTransport } from '../transport.ts'

type UpdateCheckResult = {
  available: boolean
  versionName?: string
  notes?: string
}

type UpdateInstallResult = {
  installed?: boolean
  error?: string
}

type KennkoUpdatePlugin = {
  check(): Promise<UpdateCheckResult>
  install(): Promise<UpdateInstallResult>
}

function getUpdatePlugin(): KennkoUpdatePlugin | undefined {
  return (window as unknown as { Capacitor?: { Plugins?: { KennkoUpdate?: KennkoUpdatePlugin } } })
    ?.Capacitor?.Plugins?.KennkoUpdate
}

export function UpdateBanner({ notify }: { notify: (msg: string) => void }) {
  const [update, setUpdate] = useState<{ versionName: string; notes: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const plugin = getUpdatePlugin()
    if (!plugin) return
    let cancelled = false
    plugin.check().then((res) => {
      if (cancelled || !res.available || !res.versionName) return
      setUpdate({ versionName: res.versionName, notes: res.notes ?? '' })
    }).catch(() => { /* ignore offline check */ })
    return () => { cancelled = true }
  }, [])

  if (!update) return null

  const onInstall = async () => {
    const plugin = getUpdatePlugin()
    if (!plugin || busy) return
    setBusy(true)
    try {
      await getTransport().prepareUpdate?.()
      const res = await plugin.install()
      if (res.error) notify(res.error)
    } catch {
      notify('The update did not install. Try again, or ask Julius.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="banner" role="status" style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between' }}>
      <span>
        Update {update.versionName} is ready.{update.notes ? ` ${update.notes}` : ''}
      </span>
      <span style={{ display: 'flex', gap: '8px' }}>
        <button type="button" className="btn-primary" disabled={busy} onClick={onInstall}>
          {busy ? 'Updating…' : 'Update'}
        </button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => setUpdate(null)}>
          Later
        </button>
      </span>
    </div>
  )
}
