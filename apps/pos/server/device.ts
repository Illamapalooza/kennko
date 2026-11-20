import fs from 'node:fs'
import path from 'node:path'
import type { CachedStaff, PinDirectory } from './pins.ts'
import type { Sessions } from './sessions.ts'
import type { Store } from './store.ts'
import { bounded } from './wait.ts'

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
// The format @kennko/core/staff-pin writes (global constraints). A row with any other hash could never match a PIN,
// yet would still count towards per-person mode, so it is dropped.
const PIN_HASH = /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/
// The API's own 401 codes for a device token. Any other 401 (a hosting protection page, say) is not the API speaking.
export const REVOKED_CODES: ReadonlySet<string> = new Set(['DEVICE_REVOKED', 'UNAUTHENTICATED'])
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
  Boolean(s) && typeof s.id === 'string' && s.id !== '' && typeof s.fullName === 'string' && ROLES.has(s.role) && typeof s.pinHash === 'string' && PIN_HASH.test(s.pinHash)

/**
 * The rows of a staff list from the API the till can use: well-formed, a known role, a PIN hash in the format the till
 * checks, first of each id. Used for `GET /v1/devices/me` and the sync pull alike.
 */
export function cleanStaff(list: unknown[]): CachedStaff[] {
  const seen = new Set<string>()
  const staff: CachedStaff[] = []
  for (const s of list) {
    if (!isCachedStaff(s) || seen.has(s.id)) continue
    seen.add(s.id)
    staff.push({ id: s.id, fullName: s.fullName, role: s.role, pinHash: s.pinHash })
  }
  return staff
}

/**
 * Applies one refresh to the till, from the sync pull (`{ status: 'ok', staff }`) or its revoked answer. ok: the cache is replaced, then sessions end for people no longer in it, and
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

const SOON_MS = 30_000
// How long a wrong PIN waits for the website before answering from the list the till already has.
const SOON_WAIT_MS = 2_500

/**
 * The wrong-PIN refresh (Ruling P4-1), so a PIN issued in admin a moment ago works on the next try. `soon` runs one
 * sync (`refresh`, which pulls the staff list): paired, not revoked and at most once every 30 seconds, else it does
 * nothing. It waits at most 2.5 seconds; a slower answer still lands in the cache for the next try. It resolves true
 * when it asked the API (whatever the answer, or none yet).
 */
export function createPinRefresh(opts: { dataDir: string; refresh: () => Promise<void>; now?: () => number }) {
  const now = opts.now ?? Date.now
  let lastSoon = -Infinity

  async function soon(): Promise<boolean> {
    const device = loadDevice(opts.dataDir)
    if (!device || device.revokedAt !== null) return false
    const t = now()
    if (t - lastSoon < SOON_MS) return false
    lastSoon = t
    await bounded(opts.refresh(), SOON_WAIT_MS)
    return true
  }

  return { soon }
}

/**
 * Checks a PIN; when it matches no one, refreshes the staff list (see `soon`) and checks once more. The caller counts
 * one wrong try for the whole call, however many checks it made.
 */
export async function checkPinFresh<T>(check: () => Promise<T | null>, soon: () => Promise<boolean>): Promise<T | null> {
  const first = await check()
  if (first) return first
  return (await soon()) ? check() : null
}
