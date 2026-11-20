/** A customer's card mode in words for the admin table. */
export function cardState(mode: 'none' | 'digital' | 'paper'): string {
  return mode === 'digital' ? 'Digital' : mode === 'paper' ? 'Paper' : 'No stamps yet'
}

/** Ledger reasons in words. */
export const LEDGER_REASON: Record<string, string> = {
  order: 'Order',
  order_reversed: 'Order cancelled',
  cosmetic: 'Cosmetic',
  adjustment: 'Adjustment',
}

/** A points amount with its sign: +50, -20, 0. */
export const signed = (n: number) => (n > 0 ? `+${n}` : String(n))
