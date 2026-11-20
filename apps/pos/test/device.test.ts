import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashStaffPin } from '@kennko/core/staff-pin'
import { applyDeviceInfo, fetchDeviceInfo, forgetDevice, loadDevice, pairWithApi, saveDevice, type DeviceFile } from '../server/device.ts'
import { createPinDirectory, type CachedStaff } from '../server/pins.ts'
import { createSessions } from '../server/sessions.ts'
import { createStore } from '../server/store.ts'

const T = Date.UTC(2026, 10, 20, 1, 0)
const URL_ = 'https://api.kennko.test'
const TOKEN = 'kd_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'

const made: string[] = []
const tempDir = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kennko-device-')); made.push(dir); return dir }
afterAll(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }) })

type Call = { url: string; init?: RequestInit }
function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init }
    calls.push(call)
    return respond(call)
  }) as typeof fetch
  return { fn, calls }
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const down = fakeFetch(() => { throw new TypeError('fetch failed') })

let bea: CachedStaff
let ana: CachedStaff
beforeAll(async () => {
  bea = { id: 'b-1', fullName: 'Bea', role: 'barista', pinHash: await hashStaffPin('111111') }
  ana = { id: 'm-1', fullName: 'Ana Cruz', role: 'manager', pinHash: await hashStaffPin('222222') }
})

function till(cache: CachedStaff[] = []) {
  const store = createStore(':memory:')
  store.replaceStaffCache(cache)
  const sessions = createSessions(store.db, () => T)
  const pins = createPinDirectory({ staffPin: '1234', managerPin: '0000', staff: () => store.staffCache() })
  return { store, sessions, pins }
}

describe('pairing with the API', () => {
  it('posts the code to /v1/devices/pair and returns the device file', async () => {
    const api = fakeFetch(() => reply(200, { deviceId: 'd-1', name: 'Counter', ticketSeries: 'C', token: TOKEN }))
    const device = await pairWithApi(`${URL_}/`, '482913', T, api.fn)
    expect(device).toEqual({ deviceId: 'd-1', name: 'Counter', token: TOKEN, pairedAt: T, revokedAt: null })
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0]!.url).toBe(`${URL_}/v1/devices/pair`)
    expect(api.calls[0]!.init?.method).toBe('POST')
    expect(JSON.parse(String(api.calls[0]!.init?.body))).toEqual({ code: '482913' })
  })

  it('says the code is wrong on a 401', async () => {
    const api = fakeFetch(() => reply(401, { code: 'PAIRING_FAILED', message: 'nope' }))
    await expect(pairWithApi(URL_, '482913', T, api.fn)).rejects.toThrow('That code is wrong or has expired. Ask the owner for a new one in admin › Tills.')
  })

  it('says the website is unreachable when fetch throws', async () => {
    await expect(pairWithApi(URL_, '482913', T, down.fn)).rejects.toThrow('Could not reach the website. Check the internet and try again.')
  })

  it('says the connection is not set up without an API address', async () => {
    await expect(pairWithApi('', '482913', T, down.fn)).rejects.toThrow('The website connection is not set up on this computer.')
  })

  it('refuses an answer without a token', async () => {
    const api = fakeFetch(() => reply(200, { deviceId: 'd-1', name: 'Counter' }))
    await expect(pairWithApi(URL_, '482913', T, api.fn)).rejects.toThrow()
  })
})

describe('the device file', () => {
  it('round-trips through save and load, readable by the owner only', () => {
    const dir = tempDir()
    expect(loadDevice(dir)).toBeNull()
    const device: DeviceFile = { deviceId: 'd-1', name: 'Counter', token: TOKEN, pairedAt: T, revokedAt: null }
    saveDevice(dir, device)
    expect(loadDevice(dir)).toEqual(device)
    if (process.platform !== 'win32') expect(fs.statSync(path.join(dir, 'device.json')).mode & 0o777).toBe(0o600)
    expect(fs.readdirSync(dir)).toEqual(['device.json'])
    forgetDevice(dir)
    expect(loadDevice(dir)).toBeNull()
    forgetDevice(dir) // forgetting twice is fine
  })

  it('treats a broken file as not paired', () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, 'device.json'), '{not json')
    expect(loadDevice(dir)).toBeNull()
  })
})

describe('fetching the device info', () => {
  it('sends the device token and returns the staff on a 200', async () => {
    const api = fakeFetch(() => reply(200, { device: { id: 'd-1', name: 'Counter', ticketSeries: 'C' }, staff: [bea, ana] }))
    const result = await fetchDeviceInfo(URL_, TOKEN, api.fn)
    expect(result).toEqual({ status: 'ok', staff: [bea, ana] })
    expect(api.calls[0]!.url).toBe(`${URL_}/v1/devices/me`)
    expect(new Headers(api.calls[0]!.init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`)
  })

  it('drops staff rows it cannot use', async () => {
    const api = fakeFetch(() => reply(200, { staff: [bea, { id: 'x', fullName: 'X', role: 'janitor', pinHash: 'h' }, { id: 'y' }] }))
    expect(await fetchDeviceInfo(URL_, TOKEN, api.fn)).toEqual({ status: 'ok', staff: [bea] })
  })

  it('drops rows whose hash is not in the pinned scrypt format, so they cannot turn per-person on', async () => {
    const odd = [
      { ...ana, id: 'm-2', pinHash: 'plain-text' },
      { ...ana, id: 'm-3', pinHash: ana.pinHash.replace('scrypt$16384$', 'scrypt$1024$') },
      { ...ana, id: 'm-4', pinHash: ana.pinHash.replace('$8$1$', '$8$2$') },
      { ...ana, id: 'm-5', pinHash: `${ana.pinHash}$extra` },
      { ...ana, id: 'm-6', pinHash: ana.pinHash.replace(/\$[^$]+$/, '$not+base64url') },
    ]
    const result = await fetchDeviceInfo(URL_, TOKEN, fakeFetch(() => reply(200, { staff: [bea, ...odd] })).fn)
    expect(result).toEqual({ status: 'ok', staff: [bea] })
    const t = till([])
    applyDeviceInfo(t.store, t.sessions, t.pins, result, tempDir(), T)
    expect(t.pins.mode()).toBe('shared')
  })

  it('is revoked on a 401 from the API (DEVICE_REVOKED or UNAUTHENTICATED)', async () => {
    expect(await fetchDeviceInfo(URL_, TOKEN, fakeFetch(() => reply(401, { code: 'DEVICE_REVOKED', message: 'gone' })).fn)).toEqual({ status: 'revoked' })
    expect(await fetchDeviceInfo(URL_, TOKEN, fakeFetch(() => reply(401, { code: 'UNAUTHENTICATED', message: 'bad token' })).fn)).toEqual({ status: 'revoked' })
  })

  it('is offline on any other 401, such as a hosting protection page', async () => {
    expect(await fetchDeviceInfo(URL_, TOKEN, fakeFetch(() => new Response('<html>Authentication required</html>', { status: 401 })).fn)).toEqual({ status: 'offline' })
    expect(await fetchDeviceInfo(URL_, TOKEN, fakeFetch(() => reply(401, { code: 'SOMETHING_ELSE' })).fn)).toEqual({ status: 'offline' })
  })

  it('is offline when fetch throws, on a 503, or with a body it cannot read', async () => {
    expect(await fetchDeviceInfo(URL_, TOKEN, down.fn)).toEqual({ status: 'offline' })
    expect(await fetchDeviceInfo(URL_, TOKEN, fakeFetch(() => reply(503, {})).fn)).toEqual({ status: 'offline' })
    expect(await fetchDeviceInfo(URL_, TOKEN, fakeFetch(() => new Response('<html>', { status: 200 })).fn)).toEqual({ status: 'offline' })
  })
})

describe('per-person PINs from the staff cache', () => {
  it('turns on once the cache holds a manager, and ignores the config PINs', async () => {
    const { pins } = till([bea, ana])
    expect(pins.mode()).toBe('per-person')
    expect(await pins.checkGate('111111')).toEqual({ staffId: 'b-1', role: 'staff', name: 'Bea' })
    expect(await pins.checkGate('222222')).toEqual({ staffId: 'm-1', role: 'manager', name: 'Ana Cruz' })
    expect(await pins.checkGate('1234')).toBeNull()
    expect(await pins.checkGate('0000')).toBeNull()
    expect(await pins.checkGate('333333')).toBeNull()
    expect(await pins.checkManager('111111')).toBeNull()
    expect(await pins.checkManager('222222')).toEqual({ staffId: 'm-1', role: 'manager', name: 'Ana Cruz' })
    expect(await pins.checkManager('0000')).toBeNull()
  })

  it('stays shared while the cache holds only baristas', async () => {
    const { pins } = till([bea])
    expect(pins.mode()).toBe('shared')
    expect(await pins.checkGate('1234')).toEqual({ staffId: null, name: null, role: 'staff' })
    expect(await pins.checkGate('111111')).toBeNull()
  })

  it('replaces the whole cache at once', () => {
    const { store } = till([bea, ana])
    expect(store.staffCache().map((s) => s.id).sort()).toEqual(['b-1', 'm-1'])
    store.replaceStaffCache([ana])
    expect(store.staffCache()).toEqual([ana])
  })
})

describe('applying a refresh (Review Focus 4)', () => {
  it('still lets people in when the API is offline', async () => {
    const t = till([bea, ana])
    const dir = tempDir()
    expect(applyDeviceInfo(t.store, t.sessions, t.pins, { status: 'offline' }, dir, T)).toBe(false)
    expect(t.store.staffCache()).toHaveLength(2)
    expect(await t.pins.checkGate('111111')).toEqual({ staffId: 'b-1', role: 'staff', name: 'Bea' })
  })

  it('ends the session of a person dropped from the cache and keeps the others', () => {
    const t = till([bea, ana])
    const beaToken = t.sessions.start({ staffId: 'b-1', name: 'Bea', role: 'staff' })
    const anaToken = t.sessions.start({ staffId: 'm-1', name: 'Ana Cruz', role: 'manager' })
    expect(applyDeviceInfo(t.store, t.sessions, t.pins, { status: 'ok', staff: [ana] }, tempDir(), T)).toBe(true)
    expect(t.sessions.get(beaToken)).toBeNull()
    expect(t.sessions.get(anaToken)).toEqual({ staffId: 'm-1', name: 'Ana Cruz', role: 'manager' })
    expect(t.store.staffCache()).toEqual([ana])
  })

  it('ends shared sessions when per-person turns on', () => {
    const t = till([])
    const shared = t.sessions.start({ staffId: null, name: null, role: 'staff' })
    applyDeviceInfo(t.store, t.sessions, t.pins, { status: 'ok', staff: [bea] }, tempDir(), T)
    expect(t.sessions.get(shared)).not.toBeNull() // only a barista: still shared
    applyDeviceInfo(t.store, t.sessions, t.pins, { status: 'ok', staff: [bea, ana] }, tempDir(), T)
    expect(t.pins.mode()).toBe('per-person')
    expect(t.sessions.get(shared)).toBeNull()
  })

  it('marks the device revoked and keeps the cache', async () => {
    const t = till([bea, ana])
    const dir = tempDir()
    saveDevice(dir, { deviceId: 'd-1', name: 'Counter', token: TOKEN, pairedAt: T - 1000, revokedAt: null })
    expect(applyDeviceInfo(t.store, t.sessions, t.pins, { status: 'revoked' }, dir, T)).toBe(true)
    expect(loadDevice(dir)).toMatchObject({ deviceId: 'd-1', revokedAt: T })
    expect(t.store.staffCache()).toHaveLength(2)
    expect(await t.pins.checkGate('111111')).not.toBeNull()
    // A second revoked answer keeps the first time.
    applyDeviceInfo(t.store, t.sessions, t.pins, { status: 'revoked' }, dir, T + 5000)
    expect(loadDevice(dir)?.revokedAt).toBe(T)
  })
})
