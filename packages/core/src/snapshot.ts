import { SIZE_ORDER, type DrinkSize, type Menu, type MenuItem, type ModifierGroup } from './menu.ts'

export type Temperature = 'iced' | 'hot' | 'none'
export type SnapshotVariant = { id: string; code: string; label: string; priceCentavos: number; temperature: Temperature; isAvailable: boolean }
export type SnapshotOption = { id: string; name: string; priceCentavos: number; isAvailable: boolean }
export type SnapshotOptionGroup = { id: string; name: string; minSelect: number; maxSelect: number; options: SnapshotOption[] }
export type SnapshotItem = { id: string; name: string; description: string | null; imagePath: string | null; isBestseller: boolean; isAvailable: boolean; variants: SnapshotVariant[]; optionGroupIds: string[] }
export type SnapshotCategory = { id: string; name: string; kind: 'drink' | 'food'; items: SnapshotItem[] }
export type DiscountPreset = { id: string; label: string; kind: 'percent' | 'amount'; value: number }
export type SnapshotBody = { categories: SnapshotCategory[]; optionGroups: SnapshotOptionGroup[]; discountPresets: DiscountPreset[] }
export type MenuSnapshot = SnapshotBody & { version: number; publishedAt: string }

/** Adapts a published snapshot to the drink-only `Menu` shape the till and website drink screens use. */
export function liveDrinkMenu(snapshot: MenuSnapshot, now: number): Menu {
  const usedGroupIds = new Set<string>()
  const categories: Menu['categories'] = []

  for (const category of snapshot.categories) {
    if (category.kind !== 'drink') continue
    const items: MenuItem[] = []
    for (const item of category.items) {
      const prices = SIZE_ORDER.flatMap((size: DrinkSize) => {
        const variant = item.variants.find((v) => v.code === size)
        return variant ? [{ size, priceCentavos: variant.priceCentavos }] : []
      })
      if (prices.length === 0) continue
      items.push({ id: item.id, name: item.name, isBestseller: item.isBestseller, isAvailable: item.isAvailable, prices })
      for (const groupId of item.optionGroupIds) usedGroupIds.add(groupId)
    }
    if (items.length > 0) categories.push({ id: category.id, name: category.name, items })
  }

  const modifierGroups: ModifierGroup[] = snapshot.optionGroups
    .filter((g) => usedGroupIds.has(g.id))
    .map((g) => ({
      id: g.id,
      name: g.name,
      isMultiSelect: g.maxSelect > 1,
      modifiers: g.options.map((o) => ({ id: o.id, name: o.name, priceCentavos: o.priceCentavos, isAvailable: o.isAvailable })),
    }))

  return { categories, modifierGroups, source: 'website', updatedAt: now }
}
