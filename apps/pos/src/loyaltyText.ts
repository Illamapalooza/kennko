import { CODE_ALPHABET, STAMPS_PER_CARD, type Order, type TillCustomer } from '@kennko/core'

/** `KC-7F3-…-XAM`: the middle group stays off the screen everywhere but the add-customer window. */
export function maskCode(code: string): string {
  const bare = code.toUpperCase().replace(/[\s-]+/g, '').replace(/^KC(?=.{9}$)/, '')
  if (bare.length !== 9) return ''
  return `KC-${bare.slice(0, 3)}-…-${bare.slice(6)}`
}

/** What the till shows once a code has been looked up (or could not be). It leads with the cat's name when there is one. */
export function customerLine(c: TillCustomer | null, note?: string): string {
  if (!c) return note || 'Will confirm when back online'
  if (c.stampMode === 'paper') return 'Paper card: stamp their paper card'
  const ready = c.fullCards > 0 ? ` · ${c.fullCards === 1 ? 'Free drink ready' : `${c.fullCards} free drinks ready`}` : ''
  const lead = c.catName ? `${c.catName} ·` : 'Card'
  return `${lead} ${maskCode(c.code)} · ${c.stamps} of ${STAMPS_PER_CARD} stamps${ready}`
}

/** The code field as it is typed: upper case, `KC-` in front, grouped in threes, at most nine symbols. */
export function typedCode(input: string): string {
  let s = input.toUpperCase().replace(/[\s-]+/g, '')
  if (s.startsWith('KC') && s.length > 9) s = s.slice(2)
  const symbols = [...s].filter((ch) => CODE_ALPHABET.includes(ch)).slice(0, 9).join('')
  if (!symbols) return ''
  return `KC-${symbols.match(/.{1,3}/g)!.join('-')}`
}

/** The counter ticket's stamp button: null when there is nothing to stamp. A sale of only the free drink earns no stamp. */
export function stampButtonLabel(order: Pick<Order, 'customerCode' | 'stamped' | 'status' | 'lines'>): string | null {
  if (!order.customerCode || order.status === 'voided') return null
  if (order.stamped) return 'Stamped'
  if (order.lines.every((l) => l.reward)) return null
  return 'Stamp card'
}

/** The online ticket's card button, from the `card` the pull carries. */
export function onlineCardLabel(card: 'stamp' | 'stamped' | 'paper' | null | undefined): string | null {
  if (card === 'stamp') return 'Stamp at pickup'
  if (card === 'stamped') return 'Stamped'
  if (card === 'paper') return 'Paper card'
  return null
}

/**
 * Makes one drink the free one. A line of 2 or more becomes 1 free + the rest; any earlier free mark moves here
 * (a cart holds at most one free drink).
 */
export function splitReward<T extends { key: string; quantity: number; reward?: boolean }>(lines: T[], key: string, newKey: () => string): T[] {
  const plain = (l: T): T => { const { reward: _reward, ...rest } = l; return rest as T }
  return lines.flatMap((l): T[] => {
    if (l.key !== key) return [plain(l)]
    if (l.quantity <= 1) return [{ ...l, reward: true }]
    return [{ ...l, quantity: 1, reward: true }, { ...plain(l), key: newKey(), quantity: l.quantity - 1 }]
  })
}
