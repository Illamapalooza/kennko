'use client'

import { useEffect, useState } from 'react'
import { browserPushEnv, getRegistration, pushSupport, urlBase64ToUint8Array } from '@/lib/push/client'
import { unsubscribePush } from '@/app/push-actions'

type Result = { ok: boolean; message?: string }

type Props = {
  /** Sends a new subscription to the API. */
  subscribe: (subscription: PushSubscriptionJSON) => Promise<Result>
  labelOff: string
  labelOn: string
  className?: string
  hintClassName?: string
  /** Remembers on this device that this particular toggle was turned on (a device can follow several orders). */
  storageKey?: string
}

type State = 'hidden' | 'ios' | 'off' | 'on' | 'busy' | 'blocked'

const IOS_COPY = 'On iPhone, add Kennko to your Home Screen first (Share → Add to Home Screen), then turn on notifications there.'
const BLOCKED_COPY = 'Notifications are blocked in your browser settings.'
const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

function remembered(key?: string): boolean {
  if (!key) return true
  try { return localStorage.getItem(key) === '1' } catch { return false }
}
function remember(key: string | undefined, on: boolean) {
  if (!key) return
  try { if (on) localStorage.setItem(key, '1'); else localStorage.removeItem(key) } catch { /* private mode */ }
}

/** The shared mechanics of "notify me" buttons. Renders nothing where push cannot work. */
export function PushToggle({ subscribe, labelOff, labelOn, className, hintClassName, storageKey }: Props) {
  // 'hidden' on the server and first paint so the markup matches before the browser is asked.
  const [state, setState] = useState<State>('hidden')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!PUBLIC_KEY) return
    let cancelled = false
    ;(async () => {
      const support = pushSupport(browserPushEnv())
      if (support === 'unsupported') return
      if (support === 'ios-needs-install') { if (!cancelled) setState('ios'); return }
      const registration = await getRegistration()
      if (cancelled || !registration) return // development, or no worker: treat as unsupported
      if (Notification.permission === 'denied') { setState('blocked'); return }
      const existing = await registration.pushManager.getSubscription()
      if (!cancelled) setState(existing && remembered(storageKey) ? 'on' : 'off')
    })().catch(() => { /* leave hidden */ })
    return () => { cancelled = true }
  }, [storageKey])

  async function turnOn() {
    if (!PUBLIC_KEY) return
    setState('busy'); setMessage(null)
    try {
      const registration = await getRegistration()
      if (!registration) { setState('hidden'); return }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setState('blocked'); return }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(PUBLIC_KEY),
      })
      const result = await subscribe(subscription.toJSON())
      if (!result.ok) {
        setMessage(result.message ?? "Couldn't turn on notifications. Try again.")
        setState('off')
        return
      }
      remember(storageKey, true)
      setState('on')
    } catch {
      setMessage("Couldn't turn on notifications. Try again.")
      setState('off')
    }
  }

  async function turnOff() {
    setState('busy'); setMessage(null)
    try {
      const registration = await getRegistration()
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        await unsubscribePush(subscription.endpoint)
        await subscription.unsubscribe()
      }
      remember(storageKey, false)
      setState('off')
    } catch {
      setMessage("Couldn't turn off notifications. Try again.")
      setState('on')
    }
  }

  if (state === 'hidden') return null
  if (state === 'ios') return <p className={hintClassName}>{IOS_COPY}</p>
  if (state === 'blocked') return <p className={hintClassName}>{BLOCKED_COPY}</p>

  const on = state === 'on'
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={state === 'busy'}
        onClick={() => void (on ? turnOff() : turnOn())}
      >
        {on ? labelOn : labelOff}
      </button>
      {message ? <p className={hintClassName} role="status">{message}</p> : null}
    </>
  )
}
