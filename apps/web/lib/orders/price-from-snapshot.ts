import type { MenuSnapshot } from '@kennko/core'
import type { SubmittedLine } from './create'

// Only M/L/XL/HOT are accepted until the cart knows about other variants.
const SELLABLE_CODES = ['M', 'L', 'XL', 'HOT']

export type PricedLine =
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
export function priceLineFromSnapshot(snapshot: MenuSnapshot, line: SubmittedLine): PricedLine {
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
