/** Money is always whole centavos. Pesos only appear at the edges (typing and printing). */
export function formatPesos(centavos: number): string {
  if (!Number.isInteger(centavos)) throw new Error('centavos must be an integer')
  const sign = centavos < 0 ? '-' : ''
  const abs = Math.abs(centavos)
  const hasFraction = abs % 100 !== 0
  return `${sign}₱${(abs / 100).toLocaleString('en-PH', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}

/** "150", "150.5", "1,250.75" -> centavos. Returns null for anything that is not a plain peso amount. */
export function parsePesos(text: string): number | null {
  const clean = text.replace(/[₱,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null
  return Math.round(Number(clean) * 100)
}
