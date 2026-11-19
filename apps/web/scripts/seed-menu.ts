import { createClient } from '@supabase/supabase-js'
import { SEED_CATEGORIES, SEED_MODIFIER_GROUPS } from '../supabase/seed/menu'
import { VARIANT_META } from '../app/admin/menu/format'
import type { VariantCode } from '../lib/menu/types'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
}

const db = createClient(url, serviceKey)

async function main() {
  let itemCount = 0
  let priceCount = 0
  const drinkItemIds: string[] = []

  for (const category of SEED_CATEGORIES) {
    const { data: cat, error: catError } = await db
      .from('menu_categories')
      .upsert({ name: category.name, kind: 'drink', sort_order: category.sortOrder }, { onConflict: 'name' })
      .select('id')
      .single()
    if (catError) throw catError

    for (const [index, item] of category.items.entries()) {
      const { data: row, error: itemError } = await db
        .from('menu_items')
        .upsert(
          {
            category_id: cat.id,
            name: item.name,
            is_bestseller: item.isBestseller,
            sort_order: index,
          },
          { onConflict: 'category_id,name' },
        )
        .select('id')
        .single()
      if (itemError) throw itemError
      itemCount += 1

      drinkItemIds.push(row.id)

      const priceRows = Object.entries(item.prices)
        .filter(([, value]) => value !== null)
        .map(([code, value]) => ({
          item_id: row.id,
          code,
          label: VARIANT_META[code as VariantCode].label,
          price_centavos: value as number,
          temperature: VARIANT_META[code as VariantCode].temperature,
          sort_order: VARIANT_META[code as VariantCode].sortOrder,
          is_archived: false,
        }))

      const { error: priceError } = await db
        .from('menu_variants')
        .upsert(priceRows, { onConflict: 'item_id,code' })
      if (priceError) throw priceError
      priceCount += priceRows.length
    }
  }

  let modifierCount = 0
  const groupIds: { id: string; sortOrder: number }[] = []
  for (const group of SEED_MODIFIER_GROUPS) {
    const { data: grp, error: groupError } = await db
      .from('option_groups')
      .upsert(
        {
          name: group.name,
          min_select: 0,
          max_select: group.isMultiSelect ? 5 : 1,
          sort_order: group.sortOrder,
        },
        { onConflict: 'name' },
      )
      .select('id')
      .single()
    if (groupError) throw groupError
    groupIds.push({ id: grp.id, sortOrder: group.sortOrder })

    const { error: optionError } = await db.from('options').upsert(
      group.modifiers.map((m, i) => ({
        group_id: grp.id,
        name: m.name,
        price_centavos: m.priceCentavos,
        sort_order: i,
      })),
      { onConflict: 'group_id,name' },
    )
    if (optionError) throw optionError
    modifierCount += group.modifiers.length
  }

  // Every add-on group applies to every drink, as the migration backfill did.
  const links = drinkItemIds.flatMap((itemId) =>
    groupIds.map((g) => ({ item_id: itemId, group_id: g.id, sort_order: g.sortOrder })),
  )
  const { error: linkError } = await db
    .from('item_option_groups')
    .upsert(links, { onConflict: 'item_id,group_id' })
  if (linkError) throw linkError

  console.log(
    `Seeded ${SEED_CATEGORIES.length} categories, ${itemCount} items, ` +
      `${priceCount} prices, ${modifierCount} modifiers.`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
