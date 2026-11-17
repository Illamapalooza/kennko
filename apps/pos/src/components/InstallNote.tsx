import { useInstall } from '../pwa.ts'

/** Shown under the PIN pad: how to put the till on this device's home screen. Says nothing once installed. */
export function InstallNote({ secureUrl }: { secureUrl: string | null }) {
  const { state, install } = useInstall()
  if (state === 'installed' || state === 'none') return null
  return (
    <div className="install-note">
      {state === 'ready' ? (
        <button type="button" className="btn install-btn" onClick={install}>Install Kennko POS on this device</button>
      ) : null}
      {state === 'ios' ? (
        <p>To install: tap <b>Share</b>, then <b>Add to Home Screen</b>.</p>
      ) : null}
      {state === 'insecure' ? (
        secureUrl
          ? <p>To install this as an app, open <a href="/setup">the setup page</a> once on this device.</p>
          : <p>Installing as an app needs the secure address, which is not running on the till computer.</p>
      ) : null}
    </div>
  )
}
