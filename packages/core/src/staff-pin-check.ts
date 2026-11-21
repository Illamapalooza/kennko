import { scryptAsync } from '@noble/hashes/scrypt.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import { sameBytes } from './portable-crypto.ts'

const N = 16384
const KEY_LENGTH = 32
const MAXMEM = 64 * 1024 * 1024

function decodeBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function isStaffPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{6}$/.test(pin)
}

/** Never throws: a malformed `stored`, out-of-range cost parameters or a non-PIN all return false. */
export async function checkStaffPin(pin: string, stored: string): Promise<boolean> {
  try {
    if (!isStaffPin(pin) || typeof stored !== 'string') return false
    const parts = stored.split('$')
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false
    const [n, r, p] = [parts[1], parts[2], parts[3]].map((v) => (/^\d+$/.test(v!) ? Number(v) : NaN))
    // Bound the cost so a tampered hash cannot make the till burn memory.
    if (!(n >= N && n <= 2 ** 20) || !(r >= 1 && r <= 16) || !(p >= 1 && p <= 4)) return false
    if ((n & (n - 1)) !== 0) return false // scrypt needs a power of two
    const salt = decodeBase64Url(parts[4]!)
    const expected = decodeBase64Url(parts[5]!)
    if (!salt || salt.length === 0 || !expected || expected.length !== KEY_LENGTH) return false
    const actual = await scryptAsync(utf8ToBytes(pin), salt, { N: n, r, p, dkLen: KEY_LENGTH, maxmem: MAXMEM })
    return sameBytes(actual, expected)
  } catch {
    return false
  }
}
