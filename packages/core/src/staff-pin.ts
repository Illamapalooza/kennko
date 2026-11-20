// Node only (node:crypto). Not exported from index.ts: the website bundles that for the browser.
import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto'

const N = 16384
const R = 8
const P = 1
const KEY_LENGTH = 32
const SALT_LENGTH = 16
const MAXMEM = 64 * 1024 * 1024

const scryptAsync = (pin: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(pin, salt, KEY_LENGTH, { N: n, r, p, maxmem: MAXMEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    )
  })

export function isStaffPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{6}$/.test(pin)
}

/** `scrypt$N$r$p$<salt base64url>$<key base64url>` with a fresh 16-byte salt. */
export async function hashStaffPin(pin: string): Promise<string> {
  if (!isStaffPin(pin)) throw new Error('A staff PIN is exactly 6 digits')
  const salt = randomBytes(SALT_LENGTH)
  const key = await scryptAsync(pin, salt, N, R, P)
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

/** Never throws: a malformed `stored`, out-of-range cost parameters or a non-PIN all return false. */
export async function checkStaffPin(pin: string, stored: string): Promise<boolean> {
  try {
    if (!isStaffPin(pin) || typeof stored !== 'string') return false
    const parts = stored.split('$')
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false
    const [n, r, p] = [parts[1], parts[2], parts[3]].map((v) => (/^\d+$/.test(v) ? Number(v) : NaN))
    // Bound the cost so a tampered hash cannot make the till burn memory.
    if (!(n >= N && n <= 2 ** 20) || !(r >= 1 && r <= 16) || !(p >= 1 && p <= 4)) return false
    if ((n & (n - 1)) !== 0) return false // scrypt needs a power of two
    const salt = Buffer.from(parts[4], 'base64url')
    const expected = Buffer.from(parts[5], 'base64url')
    if (salt.length === 0 || expected.length !== KEY_LENGTH) return false
    const actual = await scryptAsync(pin, salt, n, r, p)
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

/** Six digits, zero-padded; never all the same digit, 123456 or 654321. */
export function randomStaffPin(): string {
  for (;;) {
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0')
    if (/^(\d)\1{5}$/.test(pin) || pin === '123456' || pin === '654321') continue
    return pin
  }
}
