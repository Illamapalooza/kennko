// Line and cart maths are shared with the till, so both price a drink the same way.
export { lineTotal, cartSubtotal, type PricedInput as PricedLine } from '@kennko/core'

export function orderTotal(subtotalCentavos: number, feeCentavos: number): number {
  return subtotalCentavos + feeCentavos
}

// Excludes 0/O, 1/I/L, B/8, S/5, 2/Z, G/6 -- customers read these aloud.
const CODE_ALPHABET = 'ACDEFHJKLMNPRTUVWXY34679'

export function generateOrderCode(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
  return `KNK-${chars.join('')}`
}
