import { createHash } from 'node:crypto'
import type { MenuSnapshot, SnapshotBody } from '@kennko/core'
import type postgres from 'postgres'

type Row = { version: string | number; body: SnapshotBody; published_at: Date | string }

function toSnapshot(row: Row): MenuSnapshot {
  return {
    ...row.body,
    version: Number(row.version),
    publishedAt: new Date(row.published_at).toISOString(),
  }
}

/** A stored snapshot exactly as published. */
export async function readMenuVersion(sql: postgres.Sql, version: number): Promise<MenuSnapshot | null> {
  const [row] = await sql<Row[]>`select version, body, published_at from menu_snapshots where version = ${version}`
  return row ? toSnapshot(row) : null
}

/** The latest snapshot with live sold-out flags overlaid, and an ETag that changes when they do. */
export async function readLatestMenu(sql: postgres.Sql): Promise<{ snapshot: MenuSnapshot; etag: string } | null> {
  const [row] = await sql<Row[]>`
    select version, body, published_at from menu_snapshots order by version desc limit 1`
  if (!row) return null
  const snapshot = toSnapshot(row)

  const rows = await sql<{ id: string }[]>`
    select id from menu_items where not is_available
    union all select id from menu_variants where not is_available
    union all select id from options where not is_available`
  const off = new Set(rows.map((r) => r.id))

  const unavailable: string[] = []
  const mark = (x: { id: string; isAvailable: boolean }) => {
    if (off.has(x.id)) {
      x.isAvailable = false
      unavailable.push(x.id)
    }
  }
  for (const cat of snapshot.categories) {
    for (const item of cat.items) {
      mark(item)
      item.variants.forEach(mark)
    }
  }
  for (const group of snapshot.optionGroups) group.options.forEach(mark)

  const digest = createHash('sha256').update(unavailable.sort().join(',')).digest('hex').slice(0, 8)
  return { snapshot, etag: `"v${snapshot.version}-${digest}"` }
}
