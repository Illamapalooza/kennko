export type PricedLine = {
  basePriceCentavos: number
  modifiers: { priceCentavos: number }[]
  quantity: number
}

export function lineTotal(line: PricedLine): number {
  if (line.quantity < 1) throw new Error('Quantity must be at least 1')
  if (line.quantity > 20) throw new Error('Quantity cannot be more than 20')

  const modifiers = line.modifiers.reduce((sum, m) => sum + m.priceCentavos, 0)
  return (line.basePriceCentavos + modifiers) * line.quantity
}

export function cartSubtotal(lines: PricedLine[]): number {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0)
}

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
