export type PushEnv = {
  hasServiceWorker: boolean
  hasPushManager: boolean
  isIos: boolean
  isStandalone: boolean
}

export type PushSupport = 'ok' | 'ios-needs-install' | 'unsupported'

/** iPhone only offers push to a site added to the Home Screen, so a browser tab there is told to install. */
export function pushSupport(env: PushEnv): PushSupport {
  if (env.isIos && !env.isStandalone) return 'ios-needs-install'
  if (env.hasServiceWorker && env.hasPushManager) return 'ok'
  return 'unsupported'
}

/** The VAPID public key arrives as base64url; pushManager.subscribe wants bytes. */
export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function browserPushEnv(): PushEnv {
  const nav = navigator as Navigator & { standalone?: boolean }
  return {
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: 'PushManager' in window,
    isIos: /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1),
    isStandalone: window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true,
  }
}

/** The worker's registration, or null when there is none (development, or not yet installed). Never hangs. */
export async function getRegistration(timeoutMs = 1500): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
  try {
    return (await Promise.race([navigator.serviceWorker.getRegistration(), timeout])) ?? null
  } catch {
    return null
  }
}
