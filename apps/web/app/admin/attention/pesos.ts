const MAX_CENTAVOS = 100_000_000 // what the API accepts

/** `'1,480.50'` → 148050. Null for anything that is not an amount of pesos with at most two decimals. */
export function parsePesos(input: string): number | null {
  const m = /^₱?(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/.exec(input.trim())
  if (!m) return null
  const centavos = Number(m[1]!.replace(/,/g, '')) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0)
  return Number.isSafeInteger(centavos) && centavos <= MAX_CENTAVOS ? centavos : null
}
