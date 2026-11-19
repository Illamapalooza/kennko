/** Chrome's "this can be installed" event; not in the standard DOM types. */
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

/**
 * - installed: already running as an app from the home screen
 * - ready:     the browser can install it now (Chrome, Edge, Android)
 * - ios:       iPhone or iPad, where installing is done by hand from the Share menu
 * - none:      nothing to offer (unsupported browser, or the prompt has not arrived)
 */
export type InstallState = 'installed' | 'ready' | 'ios' | 'none'

let prompt: InstallPrompt | null = null
let started = false
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((fn) => fn())

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

// iPadOS reports itself as a Mac, so touch support is the tell.
const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export function installState(): InstallState {
  if (isStandalone()) return 'installed'
  if (prompt) return 'ready'
  if (isIos()) return 'ios'
  return 'none'
}

/** Listen early (from the root layout): the browser fires the event once, possibly before a button exists. */
export function startInstallListener() {
  if (started) return
  started = true
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    prompt = event as InstallPrompt
    changed()
  })
  window.addEventListener('appinstalled', () => { prompt = null; changed() })
  window.matchMedia('(display-mode: standalone)').addEventListener('change', changed)
}

export function subscribeInstall(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export async function runInstall() {
  if (!prompt) return
  const asked = prompt
  prompt = null
  await asked.prompt()
  await asked.userChoice.catch(() => null)
  changed()
}
