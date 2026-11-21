import { sha1Bytes } from '@kennko/core/portable-crypto'

/** An RFC 4122 version 5 uuid: SHA-1 of the namespace's 16 bytes then the name's UTF-8 bytes. */
export function uuid5(namespace: string, name: string): string {
  const hex = namespace.replace(/-/g, '')
  if (hex.length !== 32 || !/^[0-9a-fA-F]+$/.test(hex)) throw new Error(`Not a uuid namespace: ${namespace}`)
  const ns = new Uint8Array(16)
  for (let i = 0; i < 16; i++) ns[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  const nameBytes = new TextEncoder().encode(name)
  const input = new Uint8Array(ns.length + nameBytes.length)
  input.set(ns)
  input.set(nameBytes, ns.length)
  const b = sha1Bytes(input).slice(0, 16)
  b[6] = (b[6]! & 0x0f) | 0x50
  b[8] = (b[8]! & 0x3f) | 0x80
  let h = ''
  for (let i = 0; i < 16; i++) h += b[i]!.toString(16).padStart(2, '0')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
