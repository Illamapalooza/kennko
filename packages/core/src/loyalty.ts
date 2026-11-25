/** 31 symbols: no 0, 1, I, L or O, so a code read aloud or off a receipt is hard to get wrong. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const STAMPS_PER_CARD = 8
/** One point per ₱10 spent. */
export const CENTAVOS_PER_POINT = 1000
/** Daily bonus points: walking your cat in via wall QR, scanning your card at counter, and F2F-verified story/post. */
export const POINTS_PER_CHECKIN = 15
export const POINTS_PER_CARD_SCAN = 10
export const POINTS_PER_SOCIAL_SHARE = 25
/** How long a customer linked through a till stays in that till's pull. */
export const LINKED_RECENT_MS = 1_800_000
export const LOOKUPS_PER_MINUTE = 30

export type StampMode = 'none' | 'digital' | 'paper'

const BASE = CODE_ALPHABET.length
const CODE_LENGTH = 9

/**
 * The check symbol makes Σ (position × value) ≡ 0 (mod 31) over all nine symbols (positions 1 to 9). The modulus is
 * prime and the weights are 1 to 9, so any single wrong symbol and any swap of two different neighbours changes the sum.
 */
function checkSum(symbols: string): number | null {
  let sum = 0
  for (let i = 0; i < symbols.length; i++) {
    const v = CODE_ALPHABET.indexOf(symbols[i])
    if (v < 0) return null
    sum += (i + 1) * v
  }
  return sum % BASE
}

/** 8 random symbols plus the check symbol. `randomInt(n)` returns an integer from 0 to n - 1. */
export function makePublicCode(randomInt: (n: number) => number): string {
  let body = ''
  for (let i = 0; i < CODE_LENGTH - 1; i++) body += CODE_ALPHABET[randomInt(BASE)]
  const partial = checkSum(body) as number
  // The ninth symbol has weight 9; 9 × 7 = 63 ≡ 1 (mod 31), so 7 is its inverse.
  const check = (((BASE - partial) % BASE) * 7) % BASE
  return body + CODE_ALPHABET[check]
}

/** The 9 bare symbols for what a person typed or scanned, or null when it cannot be a code. */
export function normalisePublicCode(input: string): string | null {
  if (typeof input !== 'string') return null
  const s = input.toUpperCase().replace(/[\s-]+/g, '')
  // K and C are alphabet symbols, so a bare code may start with KC; only an 11-symbol input carries the prefix.
  const bare = s.length === CODE_LENGTH + 2 && s.startsWith('KC') ? s.slice(2) : s
  if (bare.length !== CODE_LENGTH) return null
  return checkSum(bare) === 0 ? bare : null
}

/** `KC-XXX-XXX-XXX` for a stored code. */
export function formatPublicCode(bare: string): string {
  return `KC-${bare.slice(0, 3)}-${bare.slice(3, 6)}-${bare.slice(6, 9)}`
}

/** Points for an order: the discount and the free drink earn nothing; the delivery fee is not part of this. */
export function orderPoints(o: { subtotalCentavos: number; discountCentavos: number; rewardLineCentavos: number }): number {
  const earning = o.subtotalCentavos - o.discountCentavos - o.rewardLineCentavos
  return Math.max(0, Math.floor(earning / CENTAVOS_PER_POINT))
}

/** A stamp needs a drink. An unknown counter item (`null`) counts as one, because the till sells drinks only. */
export function hasDrink(lines: { kind: 'drink' | 'food' | null }[]): boolean {
  return lines.some((l) => l.kind !== 'food')
}
