'use client'

import { useEffect, useState } from 'react'
import { installState, runInstall, startInstallListener, subscribeInstall, type InstallState } from '@/lib/pwa/install'

/**
 * Puts the app on the home screen. Says nothing once installed (or when the browser cannot):
 * a button where the browser offers the prompt, and the by-hand steps on iPhone and iPad.
 */
export function InstallAppButton({ label, className }: { label: string; className?: string }) {
  // 'none' on the server and first paint, so the markup matches before the browser is asked.
  const [state, setState] = useState<InstallState>('none')
  useEffect(() => {
    startInstallListener()
    const update = () => setState(installState())
    update()
    return subscribeInstall(update)
  }, [])

  if (state === 'ready') {
    return (
      <button type="button" className={className} onClick={() => void runInstall()}>
        {label}
      </button>
    )
  }
  if (state === 'ios') {
    return <p className="install-hint">Tap Share, then &quot;Add to Home Screen&quot;</p>
  }
  return null
}
