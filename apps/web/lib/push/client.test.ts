import { describe, expect, it } from 'vitest'
import { pushSupport, urlBase64ToUint8Array } from './client'

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
