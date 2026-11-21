import { sha1 } from '@noble/hashes/legacy.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)))
}

export function sha1Bytes(data: Uint8Array): Uint8Array {
  return sha1(data)
}

export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(buf)
  return bytesToHex(buf)
}

export function randomUuid(): string {
  return globalThis.crypto.randomUUID()
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!
  }
  return diff === 0
}
