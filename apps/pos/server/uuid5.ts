import { createHash } from 'node:crypto'

/** An RFC 4122 version 5 uuid: SHA-1 of the namespace's 16 bytes then the name's UTF-8 bytes. */
export function uuid5(namespace: string, name: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex')
  if (ns.length !== 16) throw new Error(`Not a uuid namespace: ${namespace}`)
  const b = createHash('sha1').update(ns).update(name, 'utf8').digest().subarray(0, 16)
  b[6] = (b[6]! & 0x0f) | 0x50
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
