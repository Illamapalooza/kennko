import { afterEach, describe, expect, it } from 'vitest'
import { getRegistration, pushSupport, urlBase64ToUint8Array } from './client'

const env = (o: Partial<Parameters<typeof pushSupport>[0]> = {}) => ({
  hasServiceWorker: true, hasPushManager: true, isIos: false, isStandalone: false, ...o,
})

describe('pushSupport', () => {
  it('is ok where worker and push exist', () => {
    expect(pushSupport(env())).toBe('ok')
  })
  it('is ok on an installed iPhone app', () => {
    expect(pushSupport(env({ isIos: true, isStandalone: true }))).toBe('ok')
  })
  it('asks an iPhone browser tab to install first', () => {
    expect(pushSupport(env({ isIos: true, hasPushManager: false }))).toBe('ios-needs-install')
  })
  it('is unsupported without a service worker or push elsewhere', () => {
    expect(pushSupport(env({ hasServiceWorker: false }))).toBe('unsupported')
    expect(pushSupport(env({ hasPushManager: false }))).toBe('unsupported')
  })
})

describe('urlBase64ToUint8Array', () => {
  it('decodes base64url', () => {
    expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255])
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3])
  })
})

describe('getRegistration', () => {
  const realSw = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')
  const stubWorker = (sw: unknown) => Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true })
  afterEach(() => {
    if (realSw) Object.defineProperty(navigator, 'serviceWorker', realSw)
    else delete (navigator as { serviceWorker?: unknown }).serviceWorker
  })

  it('waits for a worker that registers shortly after the first visit', async () => {
    const registration = { scope: '/' }
    stubWorker({
      getRegistration: async () => undefined,
      ready: new Promise((resolve) => setTimeout(() => resolve(registration), 20)),
    })
    expect(await getRegistration(500)).toBe(registration)
  })
  it('gives up after the timeout when no worker ever becomes ready', async () => {
    stubWorker({ getRegistration: async () => undefined, ready: new Promise(() => {}) })
    expect(await getRegistration(30)).toBeNull()
  })
  it('is null without service worker support', async () => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker
    expect(await getRegistration(30)).toBeNull()
  })
})
