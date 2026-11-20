import { createHash, randomBytes, randomInt } from 'node:crypto'

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** `kd_` + 32 random bytes, base64url. Only its SHA-256 is stored. */
export function newDeviceToken(): string {
  return `kd_${randomBytes(32).toString('base64url')}`
}

/** Six digits, zero-padded. */
export function newPairingCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}
