/** Money is always whole centavos. Pesos only appear at the edges (typing and printing). */
export function formatPesos(centavos: number): string {
  if (!Number.isInteger(centavos)) throw new Error('centavos must be an integer')
  if (centavos < 0) throw new Error('centavos must not be negative')
  const hasFraction = centavos % 100 !== 0
  return `₱${(centavos / 100).toLocaleString('en-PH', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}

/** For differences that can go either way, like a drawer that is over or short: "+₱20", "-₱5", "₱0". */
export function formatSignedPesos(centavos: number): string {
  if (centavos === 0) return formatPesos(0)
  return `${centavos > 0 ? '+' : '-'}${formatPesos(Math.abs(centavos))}`
}

/** "150", "150.5", "1,250.75" -> centavos. Returns null for anything that is not a plain peso amount. */
export function parsePesos(text: string): number | null {
  const clean = text.replace(/[₱,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null
  return Math.round(Number(clean) * 100)
}
