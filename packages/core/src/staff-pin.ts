// Node only (node:crypto). Not exported from index.ts: the website bundles that for the browser.
import { randomBytes, randomInt, scrypt } from 'node:crypto'
import { isStaffPin } from './staff-pin-check.ts'

export { checkStaffPin, isStaffPin } from './staff-pin-check.ts'

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

/** `scrypt$N$r$p$<salt base64url>$<key base64url>` with a fresh 16-byte salt. */
export async function hashStaffPin(pin: string): Promise<string> {
  if (!isStaffPin(pin)) throw new Error('A staff PIN is exactly 6 digits')
  const salt = randomBytes(SALT_LENGTH)
  const key = await scryptAsync(pin, salt, N, R, P)
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

/** Six digits, zero-padded; never all the same digit, 123456 or 654321. */
export function randomStaffPin(): string {
  for (;;) {
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0')
    if (/^(\d)\1{5}$/.test(pin) || pin === '123456' || pin === '654321') continue
    return pin
  }
}
