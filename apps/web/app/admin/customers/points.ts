/** Most points one adjustment may move (the API's limit too). */
export const POINTS_MAX = 10_000

/** '+50', '-20' and '50' are whole points; zero, decimals, junk and anything over 10,000 are null. */
export function parsePoints(text: string): number | null {
  const t = text.trim()
  if (!/^[+-]?\d+$/.test(t)) return null
  const n = Number(t)
  return n !== 0 && Math.abs(n) <= POINTS_MAX ? n : null
}
