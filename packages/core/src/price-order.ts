import type { MenuSnapshot } from './snapshot.ts'
import type { CheckoutLine } from './checkout.ts'
import { OrderError, MAX_QUANTITY, NOTE_MAX, lineTotal } from './cart.ts'
import { normaliseIce, type IceLevel, type IceServe } from './ice.ts'

// Only M/L/XL/HOT are accepted until the cart knows about other variants.
export const SELLABLE_CODES = ['M', 'L', 'XL', 'HOT']

/** Result of pricing one line against a snapshot (not the till's `PricedLine`). */
export type SnapshotPricedLine =
  | {
      ok: true
      name: string
      basePriceCentavos: number
      modifiers: { id: string; name: string; priceCentavos: number }[]
    }
  | {
      ok: false
      status: number
      code: 'ITEM_UNAVAILABLE' | 'SIZE_UNAVAILABLE' | 'MODIFIER_UNAVAILABLE'
      message: string
    }

/** Prices one submitted line from the published menu. The client's prices are never read. */
export function priceLineFromSnapshot(snapshot: MenuSnapshot, line: CheckoutLine): SnapshotPricedLine {
  const item = snapshot.categories
    .flatMap((c) => c.items)
    .find((i) => i.id === line.menuItemId)
  if (!item || !item.isAvailable) {
    return {
      ok: false,
      status: 409,
      code: 'ITEM_UNAVAILABLE',
      message: 'One of the drinks in your cart is no longer available.',
    }
  }

  const variant = item.variants.find(
    (v) => v.code === line.size && SELLABLE_CODES.includes(v.code) && v.isAvailable,
  )
  if (!variant) {
    return {
      ok: false,
      status: 409,
      code: 'SIZE_UNAVAILABLE',
      message: `${item.name} is not offered in size ${line.size}.`,
    }
  }

  // An option is only valid on items whose option groups include it.
  const allowed = snapshot.optionGroups
    .filter((g) => item.optionGroupIds.includes(g.id))
    .flatMap((g) => g.options)
  const modifiers: { id: string; name: string; priceCentavos: number }[] = []
  for (const id of line.modifierIds) {
    const option = allowed.find((o) => o.id === id)
    if (!option || !option.isAvailable) {
      return {
        ok: false,
        status: 409,
        code: 'MODIFIER_UNAVAILABLE',
        message: 'One of the add-ons you chose is no longer available.',
      }
    }
    modifiers.push({ id: option.id, name: option.name, priceCentavos: option.priceCentavos })
  }

  return { ok: true, name: item.name, basePriceCentavos: variant.priceCentavos, modifiers }
}

export type PricedOnlineLine = {
  itemId: string
  variantId: string
  variantCode: string
  variantLabel: string
  itemName: string
  unitPriceCentavos: number
  quantity: number
  lineTotalCentavos: number
  iceLevel: IceLevel | null
  iceServe: IceServe | null
  note: string | null
  options: { optionId: string; groupName: string; optionName: string; priceCentavos: number }[]
}

export type PricedOnlineOrder = { lines: PricedOnlineLine[]; subtotalCentavos: number }

/**
 * Prices a whole online order from the published menu. Throws OrderError with a
 * stable `code` so the API can map it to a response.
 */
export function priceOnlineOrder(snapshot: MenuSnapshot, lines: CheckoutLine[]): PricedOnlineOrder {
  if (lines.length === 0) throw coded('EMPTY_CART', 'Your cart is empty.')

  const priced: PricedOnlineLine[] = lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY) {
      throw coded('BAD_QUANTITY', `Quantity must be between 1 and ${MAX_QUANTITY}.`)
    }
    const result = priceLineFromSnapshot(snapshot, line)
    if (!result.ok) throw coded(result.code, result.message)

    const item = snapshot.categories.flatMap((c) => c.items).find((i) => i.id === line.menuItemId)!
    const variant = item.variants.find((v) => v.code === line.size)!
    const groups = snapshot.optionGroups.filter((g) => item.optionGroupIds.includes(g.id))
    const options = result.modifiers.map((m) => ({
      optionId: m.id,
      groupName: groups.find((g) => g.options.some((o) => o.id === m.id))!.name,
      optionName: m.name,
      priceCentavos: m.priceCentavos,
    }))

    const ice = normaliseIce(line.size, line.iceLevel, line.iceServe)
    const note = line.note?.trim().slice(0, NOTE_MAX) || null

    return {
      itemId: item.id,
      variantId: variant.id,
      variantCode: variant.code,
      variantLabel: variant.label,
      itemName: result.name,
      unitPriceCentavos: result.basePriceCentavos,
      quantity: line.quantity,
      lineTotalCentavos: lineTotal({
        basePriceCentavos: result.basePriceCentavos,
        modifiers: result.modifiers,
        quantity: line.quantity,
      }),
      iceLevel: ice.level,
      iceServe: ice.serve,
      note,
      options,
    }
  })

  return { lines: priced, subtotalCentavos: priced.reduce((sum, l) => sum + l.lineTotalCentavos, 0) }
}

function coded(code: string, message: string): OrderError {
  return Object.assign(new OrderError(message), { code })
}
