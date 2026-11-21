import { COAT_COLOURS, COSMETICS } from '@kennko/cats/pixel'
import { COSMETIC_SLOTS, type CatLook, type CosmeticSlot, type CosmeticView } from '@kennko/core'

export type ShopState = 'equippable' | 'buy' | 'short'
export type ShopItem = {
  id: string
  key: string
  name: string
  /** Points, never pesos. */
  price: number
  state: ShopState
  /** For `short`: "1 more point", "12 more points". */
  shortBy: string | null
}
export type ShopSlot = { slot: CosmeticSlot; items: ShopItem[] }

export const SLOT_LABELS: Record<CosmeticSlot, string> = { coat: 'Coat', hat: 'Hat', face: 'Face', neck: 'Neck', held: 'Held' }

/** "party_hat" / "party-hat" → "Party hat", for items the shop no longer lists. */
export function humaniseKey(key: string): string {
  const t = key.replace(/[-_]+/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

const slotOf = (key: string): CosmeticSlot | null =>
  key in COAT_COLOURS ? 'coat' : key in COSMETICS ? COSMETICS[key]!.slot : null

const more = (n: number) => `${n} more ${n === 1 ? 'point' : 'points'}`

/** Every slot in the core order, each with its items: wearable now, buyable now, or short of points. */
export function shopRows(catalogue: CosmeticView[], owned: string[], points: number): ShopSlot[] {
  const have = new Set(owned)
  const listed = new Set(catalogue.map((c) => c.key))
  // Owned but switched off (Ruling 13): still wearable, never buyable.
  const kept = owned.filter((k) => !listed.has(k) && slotOf(k))
  return COSMETIC_SLOTS.map((slot) => ({
    slot,
    items: [...catalogue
      .filter((c) => c.slot === slot)
      .map((c): ShopItem => {
        const state: ShopState = c.isStarter || have.has(c.key) ? 'equippable' : points >= c.pricePoints ? 'buy' : 'short'
        return {
          id: c.id,
          key: c.key,
          name: c.name,
          price: c.pricePoints,
          state,
          shortBy: state === 'short' ? more(c.pricePoints - points) : null,
        }
      }),
      ...kept
        .filter((k) => slotOf(k) === slot)
        .map((k): ShopItem => ({ id: k, key: k, name: humaniseKey(k), price: 0, state: 'equippable', shortBy: null })),
    ],
  }))
}

/** Try something on. The coat cannot be taken off; the other slots can. */
export function draftLook(look: CatLook, slot: CosmeticSlot, key: string | null): CatLook {
  if (slot === 'coat') return key ? { ...look, coat: key } : look
  const next = { ...look }
  if (key) next[slot] = key
  else delete next[slot]
  return next
}

/** The label for the canvas: "Mochi, a tabby cat wearing a beanie and a bandana". */
export function catLabel(name: string, look: CatLook, names: Record<string, string>): string {
  const worn = (['hat', 'face', 'neck', 'held'] as const)
    .map((s) => look[s])
    .filter((k): k is string => !!k)
    .map((k) => names[k] ?? humaniseKey(k))
  const coat = (names[look.coat] ?? humaniseKey(look.coat)).toLowerCase()
  return `${name}, a ${coat} cat${worn.length ? ` wearing ${worn.join(', ')}` : ''}`
}
