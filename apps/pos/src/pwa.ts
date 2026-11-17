import { useEffect, useState } from 'react'

/** Chrome's "this page can be installed" event; not in the standard DOM types. */
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

/**
 * - installed: already running as an app from the home screen
 * - ready:     the browser can install it now (Chrome, Edge, Android)
 * - ios:       iPad or iPhone, where installing is done by hand from the Share menu
 * - insecure:  opened over plain http on the wifi, where browsers refuse to install
 * - none:      nothing to offer (already dismissed, or an unsupported browser)
 */
export type InstallState = 'installed' | 'ready' | 'ios' | 'insecure' | 'none'

let prompt: InstallPrompt | null = null
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((fn) => fn())

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

// iPadOS reports itself as a Mac, so touch support is the tell.
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

function current(): InstallState {
  if (isStandalone()) return 'installed'
  if (prompt) return 'ready'
  if (!window.isSecureContext) return 'insecure'
  if (isIos()) return 'ios'
  return 'none'
}

/** Call once at startup. The offline copy is only kept for the built app, never during development. */
export function startPwa() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    prompt = event as InstallPrompt
    changed()
  })
  window.addEventListener('appinstalled', () => { prompt = null; changed() })
  window.matchMedia('(display-mode: standalone)').addEventListener('change', changed)

  if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* the till still works without the offline copy */ })
  }
  keepScreenOn()
}

/** A till that dims mid-shift is a nuisance; hold the screen on while the app is in front. */
function keepScreenOn() {
  const wakeLock = (navigator as { wakeLock?: { request: (type: 'screen') => Promise<unknown> } }).wakeLock
  if (!wakeLock) return
  const hold = () => { if (document.visibilityState === 'visible') wakeLock.request('screen').catch(() => { /* low battery or not allowed */ }) }
  document.addEventListener('visibilitychange', hold)
  hold()
}

export function useInstall(): { state: InstallState; install: () => Promise<void> } {
  const [state, setState] = useState<InstallState>(current)
  useEffect(() => {
    const update = () => setState(current())
    listeners.add(update)
    update()
    return () => { listeners.delete(update) }
  }, [])
  const install = async () => {
    if (!prompt) return
    const asked = prompt
    prompt = null
    await asked.prompt()
    await asked.userChoice.catch(() => null)
    changed()
  }
  return { state, install }
}
