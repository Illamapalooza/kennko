import { createClient } from '@supabase/supabase-js'
import { SEED_CATEGORIES, SEED_MODIFIER_GROUPS } from '../supabase/seed/menu'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
}

const db = createClient(url, serviceKey)

async function main() {
  let itemCount = 0
  let priceCount = 0

  for (const category of SEED_CATEGORIES) {
    const { data: cat, error: catError } = await db
      .from('menu_categories')
      .upsert({ name: category.name, sort_order: category.sortOrder }, { onConflict: 'name' })
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

      const priceRows = Object.entries(item.prices)
        .filter(([, value]) => value !== null)
        .map(([size, value]) => ({
          menu_item_id: row.id,
          size,
          price_centavos: value as number,
        }))

      const { error: priceError } = await db
        .from('menu_item_prices')
        .upsert(priceRows, { onConflict: 'menu_item_id,size' })
      if (priceError) throw priceError
      priceCount += priceRows.length
    }
  }

  let modifierCount = 0
  for (const group of SEED_MODIFIER_GROUPS) {
    const { data: grp, error: groupError } = await db
      .from('modifier_groups')
      .upsert(
        { name: group.name, is_multi_select: group.isMultiSelect, sort_order: group.sortOrder },
        { onConflict: 'name' },
      )
      .select('id')
      .single()
    if (groupError) throw groupError

    const { error: modError } = await db.from('modifiers').upsert(
      group.modifiers.map((m, i) => ({
        group_id: grp.id,
        name: m.name,
        price_centavos: m.priceCentavos,
        sort_order: i,
      })),
      { onConflict: 'group_id,name' },
    )
    if (modError) throw modError
    modifierCount += group.modifiers.length
  }

  console.log(
    `Seeded ${SEED_CATEGORIES.length} categories, ${itemCount} items, ` +
      `${priceCount} prices, ${modifierCount} modifiers.`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
