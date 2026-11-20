import fs from 'node:fs'
import path from 'node:path'
import type { CachedStaff, PinDirectory } from './pins.ts'
import type { Sessions } from './sessions.ts'
import type { Store } from './store.ts'

/**
 * This till's pairing with the Kennko API, kept in data/device.json. The token is the till's password to the API,
 * so the file is readable by the till's own user only. `revokedAt` is set when the API says the owner disconnected
 * the till in admin; the till keeps selling with its cached PINs (Ruling 10).
 */
export type DeviceFile = { deviceId: string; name: string; token: string; pairedAt: number; revokedAt: number | null }

export type DeviceInfo = { status: 'ok'; staff: CachedStaff[] } | { status: 'revoked' } | { status: 'offline' }

const FILE = 'device.json'
const TIMEOUT_MS = 15_000
const ROLES = new Set(['owner', 'manager', 'barista'])
const UNREACHABLE = 'Could not reach the website. Check the internet and try again.'
const base = (apiUrl: string) => apiUrl.trim().replace(/\/+$/, '')

export function loadDevice(dataDir: string): DeviceFile | null {
  let raw: any
  try { raw = JSON.parse(fs.readFileSync(path.join(dataDir, FILE), 'utf8')) } catch (err: any) {
    if (err.code !== 'ENOENT') console.warn(`  data/${FILE} could not be read (${err.message}); this till counts as not connected.`)
    return null
  }
  if (!raw || typeof raw.deviceId !== 'string' || typeof raw.name !== 'string' || typeof raw.token !== 'string' || !Number.isFinite(raw.pairedAt)) return null
  return { deviceId: raw.deviceId, name: raw.name, token: raw.token, pairedAt: raw.pairedAt, revokedAt: Number.isFinite(raw.revokedAt) ? raw.revokedAt : null }
}

/** Written to a temporary file and renamed over the old one, so a crash never leaves half a file. */
export function saveDevice(dataDir: string, d: DeviceFile): void {
  fs.mkdirSync(dataDir, { recursive: true })
  const file = path.join(dataDir, FILE)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 })
  fs.chmodSync(tmp, 0o600) // writeFileSync's mode only applies when it creates the file
  fs.renameSync(tmp, file)
}

export function forgetDevice(dataDir: string): void {
  fs.rmSync(path.join(dataDir, FILE), { force: true })
}

/** Swaps a 6-digit code from admin › Tills for this till's token. The only thing on the till that waits on the API. */
export async function pairWithApi(apiUrl: string, code: string, now: number, fetchFn: typeof fetch = fetch): Promise<DeviceFile> {
  if (!apiUrl.trim()) throw new Error('The website connection is not set up on this computer.')
  let res: Response
  try {
    res = await fetchFn(`${base(apiUrl)}/v1/devices/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new Error(UNREACHABLE)
  }
  if (res.status === 401 || res.status === 400) throw new Error('That code is wrong or has expired. Ask the owner for a new one in admin › Tills.')
  if (!res.ok) throw new Error(`The website refused to connect this till (${res.status}). Try again in a minute.`)
  const body: any = await res.json().catch(() => null)
  if (!body || typeof body.deviceId !== 'string' || typeof body.name !== 'string' || typeof body.token !== 'string' || !body.token.startsWith('kd_')) {
    throw new Error('The website gave an answer the till could not understand. Try again in a minute.')
  }
  return { deviceId: body.deviceId, name: body.name, token: body.token, pairedAt: now, revokedAt: null }
}

const isCachedStaff = (s: any): s is CachedStaff =>
  Boolean(s) && typeof s.id === 'string' && s.id !== '' && typeof s.fullName === 'string' && ROLES.has(s.role) && typeof s.pinHash === 'string' && s.pinHash !== ''

/** Asks the API who may use this till. Never throws: anything but a clear answer counts as offline. */
export async function fetchDeviceInfo(apiUrl: string, token: string, fetchFn: typeof fetch = fetch): Promise<DeviceInfo> {
  if (!apiUrl.trim()) return { status: 'offline' }
  try {
    const res = await fetchFn(`${base(apiUrl)}/v1/devices/me`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.status === 401) return { status: 'revoked' }
    if (!res.ok) return { status: 'offline' }
    const body: any = await res.json()
    if (!body || !Array.isArray(body.staff)) return { status: 'offline' }
    const seen = new Set<string>()
    const staff: CachedStaff[] = []
    for (const s of body.staff) {
      if (!isCachedStaff(s) || seen.has(s.id)) continue
      seen.add(s.id)
      staff.push({ id: s.id, fullName: s.fullName, role: s.role, pinHash: s.pinHash })
    }
    return { status: 'ok', staff }
  } catch {
    return { status: 'offline' }
  }
}

/**
 * Applies one refresh to the till. ok: the cache is replaced, then sessions end for people no longer in it, and
 * shared (config PIN) sessions end once per-person mode is on. revoked: the device file is marked, the cache kept.
 * offline: nothing. Returns true when the caller should tell the tablets.
 */
export function applyDeviceInfo(store: Store, sessions: Sessions, pins: PinDirectory, result: DeviceInfo, dataDir: string, now: number): boolean {
  if (result.status === 'ok') {
    store.replaceStaffCache(result.staff)
    const ids = new Set(result.staff.map((s) => s.id))
    const perPerson = pins.mode() === 'per-person'
    sessions.keepOnly((w) => (w.staffId === null ? !perPerson : ids.has(w.staffId)))
    return true
  }
  if (result.status === 'revoked') {
    const device = loadDevice(dataDir)
    if (!device || device.revokedAt !== null) return false
    saveDevice(dataDir, { ...device, revokedAt: now })
    return true
  }
  return false
}
