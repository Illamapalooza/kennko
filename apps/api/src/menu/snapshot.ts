import { createHash } from 'node:crypto'
import type { DiscountPreset, SnapshotBody, SnapshotCategory, SnapshotItem, SnapshotOptionGroup, SnapshotVariant } from '@kennko/core'
import type postgres from 'postgres'

type Db = postgres.Sql | postgres.TransactionSql

/**
 * The publishable menu as it stands now. `isAvailable` is always true here:
 * availability is overlaid when a snapshot is read, so toggling it never
 * needs a new version.
 */
export async function buildSnapshotBody(sql: Db): Promise<SnapshotBody> {
  const cats = await sql`select id, name, kind from menu_categories where is_active order by sort_order, name, id`
  const items = await sql`
    select i.id, i.category_id, i.name, i.description, i.image_path, i.is_bestseller
    from menu_items i
    join menu_categories c on c.id = i.category_id and c.is_active
    where not i.is_archived
    order by i.sort_order, i.name, i.id`
  const variants = await sql`
    select id, item_id, code, label, price_centavos, temperature
    from menu_variants where not is_archived order by sort_order, code, id`
  const links = await sql`select item_id, group_id from item_option_groups order by sort_order, group_id`
  const groups = await sql`select id, name, min_select, max_select from option_groups order by sort_order, name, id`
  const options = await sql`
    select id, group_id, name, price_centavos
    from options where not is_archived order by sort_order, name, id`
  const presets = await sql`
    select id, label, kind, value from discount_presets where is_active order by sort_order, label, id`

  const variantsByItem = new Map<string, SnapshotVariant[]>()
  for (const v of variants) {
    const list = variantsByItem.get(v.item_id) ?? []
    list.push({
      id: v.id,
      code: v.code,
      label: v.label,
      priceCentavos: v.price_centavos,
      temperature: v.temperature,
      isAvailable: true,
    })
    variantsByItem.set(v.item_id, list)
  }

  const groupIdsByItem = new Map<string, string[]>()
  for (const l of links) {
    const list = groupIdsByItem.get(l.item_id) ?? []
    list.push(l.group_id)
    groupIdsByItem.set(l.item_id, list)
  }

  const itemsByCategory = new Map<string, SnapshotItem[]>()
  const usedGroups = new Set<string>()
  for (const i of items) {
    const optionGroupIds: string[] = groupIdsByItem.get(i.id) ?? []
    for (const g of optionGroupIds) usedGroups.add(g)
    const list = itemsByCategory.get(i.category_id) ?? []
    list.push({
      id: i.id,
      name: i.name,
      description: i.description,
      imagePath: i.image_path,
      isBestseller: i.is_bestseller,
      isAvailable: true,
      variants: variantsByItem.get(i.id) ?? [],
      optionGroupIds,
    })
    itemsByCategory.set(i.category_id, list)
  }

  const optionsByGroup = new Map<string, SnapshotOptionGroup['options']>()
  for (const o of options) {
    const list = optionsByGroup.get(o.group_id) ?? []
    list.push({ id: o.id, name: o.name, priceCentavos: o.price_centavos, isAvailable: true })
    optionsByGroup.set(o.group_id, list)
  }

  const categories: SnapshotCategory[] = cats.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    items: itemsByCategory.get(c.id) ?? [],
  }))

  const optionGroups: SnapshotOptionGroup[] = groups
    .filter((g) => usedGroups.has(g.id))
    .map((g) => ({
      id: g.id,
      name: g.name,
      minSelect: g.min_select,
      maxSelect: g.max_select,
      options: optionsByGroup.get(g.id) ?? [],
    }))

  const discountPresets: DiscountPreset[] = presets.map((p) => ({
    id: p.id,
    label: p.label,
    kind: p.kind,
    value: p.value,
  }))

  return { categories, optionGroups, discountPresets }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) out[key] = canonical((value as Record<string, unknown>)[key])
    return out
  }
  return value
}

/** sha256 hex of the body as JSON with object keys sorted recursively. */
export function hashBody(body: SnapshotBody): string {
  return createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex')
}

/**
 * Publish the current menu as the next numbered snapshot, unless it is
 * identical to the latest one. Concurrent callers queue on the lock row, so
 * the second sees the first's snapshot and publishes nothing.
 */
export async function publishMenu(sql: postgres.Sql, staffId: string | null): Promise<{ version: number; created: boolean }> {
  return (await sql.begin(async (tx) => {
    await tx`select id from menu_publish_lock for update`
    const body = await buildSnapshotBody(tx)
    const hash = hashBody(body)

    const [latest] = await tx`select version, body_hash from menu_snapshots order by version desc limit 1`
    if (latest && latest.body_hash === hash) return { version: Number(latest.version), created: false }

    const [row] = await tx`
      insert into menu_snapshots (version, body, body_hash, published_by)
      select coalesce(max(version), 0) + 1, ${tx.json(JSON.parse(JSON.stringify(body)))}, ${hash}, ${staffId}
      from menu_snapshots
      returning version`
    return { version: Number(row!.version), created: true }
  })) as { version: number; created: boolean }
}
