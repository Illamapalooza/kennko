export const COSMETIC_SLOTS = ['coat', 'hat', 'face', 'neck', 'held'] as const
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number]

export const STARTER_COATS = ['ginger', 'tabby', 'black', 'cream']
export const STARTER_CAT_NAMES = ['Mochi', 'Kape', 'Biko', 'Ube', 'Turon', 'Latte', 'Mango', 'Puto']

export const CAT_NAME_MAX = 16
export const VISIT_MS = 5_400_000
export const MAX_VISITORS = 12
export const CHECKINS_PER_MINUTE = 6
export const CHECKIN_URL = 'https://kennko.vercel.app/here'
export const WALL_CODE_LENGTH = 8

export type CatLook = { coat: string } & Partial<Record<'hat' | 'face' | 'neck' | 'held', string>>

const LOOK_KEYS: readonly string[] = COSMETIC_SLOTS

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** A look from untrusted input: only slot keys, string values of 1–40 characters, a coat. */
export function parseLook(x: unknown): CatLook | null {
  if (!isRecord(x)) return null
  for (const [k, v] of Object.entries(x)) {
    if (!LOOK_KEYS.includes(k)) return null
    if (typeof v !== 'string' || v.length < 1 || v.length > 40) return null
  }
  if (typeof x.coat !== 'string') return null
  return { ...(x as CatLook) }
}

export type CatNameResult = { ok: true; name: string } | { ok: false; message: string }

export function checkCatName(raw: string): CatNameResult {
  const name = raw.trim().replace(/ {2,}/g, ' ')
  if (name.length === 0 || [...name].length > CAT_NAME_MAX) return { ok: false, message: 'Up to 16 letters or numbers.' }
  if (!/^[\p{L}\p{M}\p{Nd} .,'!?&-]+$/u.test(name)) {
    return { ok: false, message: "Letters, numbers, spaces and . , ' ! ? & - only." }
  }
  if (/\p{Nd}{4,}/u.test(name)) return { ok: false, message: 'Too many numbers in a row.' }
  if ((name.match(/\p{Nd}/gu) ?? []).length > 4) return { ok: false, message: 'No more than 4 numbers.' }
  return { ok: true, name }
}

export function wallMinute(serverMs: number): number {
  return Math.floor(serverMs / 60_000)
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'

/** First 40 bits of HMAC-SHA256(secret, "kennko-wall:" + minute) as 8 lower-case base32 characters. */
export async function wallCode(secret: string, minute: number): Promise<string> {
  const enc = new TextEncoder()
  const subtle = globalThis.crypto.subtle
  const key = await subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await subtle.sign('HMAC', key, enc.encode(`kennko-wall:${minute}`)))
  let out = ''
  let buffer = 0
  let have = 0
  for (let i = 0; i < 5; i++) {
    buffer = (buffer << 8) | mac[i]
    have += 8
    while (have >= 5) {
      out += BASE32[(buffer >> (have - 5)) & 31]
      have -= 5
      buffer &= (1 << have) - 1
    }
  }
  return out
}

export function checkinLink(url: string, code: string): string {
  return `${url}?c=${code}`
}

export type WallVisitor = { key: string; name: string; look: CatLook; endsAt: string }

export function isWallVisitor(x: unknown): x is WallVisitor {
  if (!isRecord(x)) return false
  const keys = Object.keys(x).sort().join(',')
  return (
    keys === 'endsAt,key,look,name' &&
    typeof x.key === 'string' &&
    typeof x.name === 'string' &&
    typeof x.endsAt === 'string' &&
    parseLook(x.look) !== null
  )
}
