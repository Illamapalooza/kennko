import { normaliseIce, type IceLevel, type IceServe } from './ice.ts'
import { findItem, type DrinkSize, type Menu, type MenuItem, type ModifierGroup } from './menu.ts'

/** A mistake the person at the till can fix; the message is shown to them. */
export class OrderError extends Error {}

export const MAX_QUANTITY = 20
export const MAX_LINES = 40
export const NOTE_MAX = 200
/** Add-ons on one drink; the API keeps at most this many per line. */
export const MAX_MODIFIERS = 20
export const ADDON_LIMIT_MESSAGE = `At most ${MAX_MODIFIERS} add-ons on one drink.`

/** What the till sends: ids and choices only. Prices are never trusted from the screen. */
export type LineInput = {
  menuItemId: string
  size: DrinkSize
  modifierIds: string[]
  quantity: number
  iceLevel: IceLevel | null
  iceServe: IceServe | null
  note: string
  /** The free drink from a full stamp card: base price 0, add-ons still charged. */
  reward?: boolean
}

export type PricedModifier = { id: string; name: string; priceCentavos: number }

export type PricedLine = {
  menuItemId: string
  name: string
  size: DrinkSize
  basePriceCentavos: number
  modifiers: PricedModifier[]
  quantity: number
  iceLevel: IceLevel | null
  iceServe: IceServe | null
  note: string
  lineTotalCentavos: number
  reward?: true
}

export type Discount = {
  label: string
  kind: 'percent' | 'amount'
  /** percent: 1 to 100. amount: centavos. */
  value: number
}

export type Totals = { subtotalCentavos: number; discountCentavos: number; totalCentavos: number }

export type PricedInput = { basePriceCentavos: number; modifiers: { priceCentavos: number }[]; quantity: number }

export function lineTotal(line: PricedInput): number {
  if (line.quantity < 1) throw new Error('Quantity must be at least 1')
  if (line.quantity > MAX_QUANTITY) throw new Error(`Quantity cannot be more than ${MAX_QUANTITY}`)
  const modifiers = line.modifiers.reduce((sum, m) => sum + m.priceCentavos, 0)
  return (line.basePriceCentavos + modifiers) * line.quantity
}

export function cartSubtotal(lines: PricedInput[]): number {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0)
}

/** The add-on groups a drink offers: its linked groups when the menu says, else every group. */
export function groupsFor(menu: Menu, item: MenuItem): ModifierGroup[] {
  const ids = item.modifierGroupIds
  return ids ? menu.modifierGroups.filter((g) => ids.includes(g.id)) : menu.modifierGroups
}

/** Prices one line from the menu. Throws OrderError when the menu no longer allows it. */
export function priceLine(menu: Menu, input: LineInput): PricedLine {
  const item = findItem(menu, input.menuItemId)
  if (!item) throw new OrderError('That drink is no longer on the menu.')
  if (!item.isAvailable) throw new OrderError(`${item.name} is marked sold out.`)
  const price = item.prices.find((p) => p.size === input.size)
  if (!price) throw new OrderError(`${item.name} is not offered in that size.`)
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_QUANTITY) {
    throw new OrderError(`Quantity must be 1 to ${MAX_QUANTITY}.`)
  }
  if (input.reward && input.quantity !== 1) throw new OrderError('A free drink is one drink.')

  const wanted = new Set(Array.isArray(input.modifierIds) ? input.modifierIds : [])
  const modifiers: PricedModifier[] = []
  for (const group of groupsFor(menu, item)) {
    const picked = group.modifiers.filter((m) => wanted.has(m.id))
    if (!group.isMultiSelect && picked.length > 1) throw new OrderError(`Pick only one from ${group.name}.`)
    for (const m of picked) {
      if (!m.isAvailable) throw new OrderError(`${m.name} is marked sold out.`)
      modifiers.push({ id: m.id, name: m.name, priceCentavos: m.priceCentavos })
      wanted.delete(m.id)
    }
  }
  if (wanted.size > 0) throw new OrderError('One of the add-ons is no longer on the menu.')

  const ice = normaliseIce(input.size, input.iceLevel, input.iceServe)
  const note = String(input.note ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, NOTE_MAX)
  const line = {
    menuItemId: item.id,
    name: item.name,
    size: input.size,
    basePriceCentavos: input.reward ? 0 : price.priceCentavos,
    modifiers,
    quantity: input.quantity,
    iceLevel: ice.level,
    iceServe: ice.serve,
    note,
  }
  return { ...line, lineTotalCentavos: lineTotal(line), ...(input.reward ? { reward: true as const } : {}) }
}

export function priceLines(menu: Menu, inputs: LineInput[]): PricedLine[] {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new OrderError('Add at least one drink.')
  if (inputs.length > MAX_LINES) throw new OrderError('Too many lines in one order. Split it into two.')
  if (inputs.filter((i) => i.reward).length > 1) throw new OrderError('One free drink per order.')
  return inputs.map((input) => priceLine(menu, input))
}

/** Checks a discount is well formed and returns a clean copy, or null for "no discount". */
export function cleanDiscount(discount: Discount | null | undefined): Discount | null {
  if (!discount) return null
  const label = String(discount.label ?? '').trim().slice(0, 40) || 'Discount'
  if (discount.kind === 'percent') {
    if (!Number.isFinite(discount.value) || discount.value <= 0 || discount.value > 100) {
      throw new OrderError('A percent discount must be between 1 and 100.')
    }
    return { label, kind: 'percent', value: discount.value }
  }
  if (discount.kind === 'amount') {
    if (!Number.isInteger(discount.value) || discount.value <= 0) throw new OrderError('A discount amount must be more than zero.')
    return { label, kind: 'amount', value: discount.value }
  }
  throw new OrderError('Unknown discount type.')
}

/** Never more than the subtotal: a discount cannot turn a sale into a payout. */
export function discountAmount(subtotalCentavos: number, discount: Discount | null): number {
  if (!discount) return 0
  const raw = discount.kind === 'percent' ? Math.round((subtotalCentavos * discount.value) / 100) : discount.value
  return Math.min(subtotalCentavos, Math.max(0, raw))
}

export function totals(lines: { lineTotalCentavos: number }[], discount: Discount | null): Totals {
  const subtotalCentavos = lines.reduce((sum, l) => sum + l.lineTotalCentavos, 0)
  const discountCentavos = discountAmount(subtotalCentavos, discount)
  return { subtotalCentavos, discountCentavos, totalCentavos: subtotalCentavos - discountCentavos }
}

/** Notes worth offering as one-tap cash buttons: exact, then the next round amounts above the total. */
export function quickCash(totalCentavos: number): number[] {
  const steps = [2000, 5000, 10000, 20000, 50000, 100000]
  const out = new Set<number>([totalCentavos])
  for (const step of steps) {
    const up = Math.ceil(totalCentavos / step) * step
    if (up > totalCentavos) out.add(up)
    if (out.size >= 5) break
  }
  return [...out].sort((a, b) => a - b)
}
