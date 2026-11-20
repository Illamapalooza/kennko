import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'BPUB')

const env = { hasServiceWorker: true, hasPushManager: true, isIos: false, isStandalone: false }
const pushManager = { getSubscription: vi.fn(), subscribe: vi.fn() }
let registration: { pushManager: typeof pushManager } | null = { pushManager }

vi.mock('@/lib/push/client', () => ({
  browserPushEnv: () => env,
  pushSupport: (e: typeof env) => (e.isIos && !e.isStandalone ? 'ios-needs-install' : 'ok'),
  getRegistration: async () => registration,
  urlBase64ToUint8Array: () => new Uint8Array([1]),
}))

const { PushToggle } = await import('./PushToggle')

let permission: NotificationPermission = 'default'
let requestResult: NotificationPermission = 'granted'

function renderToggle(subscribe = vi.fn(async () => ({ ok: true }))) {
  render(
    <PushToggle
      subscribe={subscribe}
      labelOff="Notify me"
      labelOn="Notifications on · Turn off"
      turnOffOnServer={async () => ({ ok: true })}
      storageKey="k-test"
    />,
  )
  return subscribe
}

beforeEach(() => {
  permission = 'default'
  requestResult = 'granted'
  env.isIos = false
  registration = { pushManager }
  pushManager.getSubscription.mockReset().mockResolvedValue(null)
  pushManager.subscribe.mockReset().mockResolvedValue({ toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/x' }) })
  localStorage.clear()
  vi.stubGlobal('Notification', {
    get permission() { return permission },
    requestPermission: vi.fn(async () => requestResult),
  })
})
afterEach(() => cleanup())

describe('PushToggle', () => {
  it('a dismissed permission prompt goes back to off, without the blocked message', async () => {
    requestResult = 'default'
    renderToggle()
    fireEvent.click(await screen.findByRole('button', { name: 'Notify me' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notify me' }).hasAttribute('disabled')).toBe(false))
    expect(screen.queryByText(/blocked/)).toBeNull()
  })

  it('a denied permission shows the blocked copy as a status', async () => {
    requestResult = 'denied'
    renderToggle()
    fireEvent.click(await screen.findByRole('button', { name: 'Notify me' }))
    expect((await screen.findByRole('status')).textContent).toMatch(/blocked in your browser settings/)
  })

  it('already blocked on load shows the blocked copy as a status', async () => {
    permission = 'denied'
    renderToggle()
    expect((await screen.findByRole('status')).textContent).toMatch(/blocked/)
  })

  it('the iPhone hint is announced as a status', async () => {
    env.isIos = true
    renderToggle()
    expect((await screen.findByRole('status')).textContent).toMatch(/Home Screen/)
  })

  it("an API that can't send keeps the button off and shows its message", async () => {
    const subscribe = renderToggle(vi.fn(async () => ({ ok: false, message: "Notifications aren't available right now." })))
    fireEvent.click(await screen.findByRole('button', { name: 'Notify me' }))
    await waitFor(() => expect(subscribe).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('status').textContent).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Notify me' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Notifications on/ })).toBeNull()
    expect(screen.getByRole('status').textContent).toBe("Notifications aren't available right now.")
    expect(localStorage.getItem('k-test')).toBeNull()
  })

  it('a granted permission and a stored subscription turn it on', async () => {
    renderToggle()
    fireEvent.click(await screen.findByRole('button', { name: 'Notify me' }))
    expect(await screen.findByRole('button', { name: 'Notifications on · Turn off' })).toBeTruthy()
  })
})
