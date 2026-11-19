import type postgres from 'postgres'
import { buildSnapshotBody, hashBody } from './snapshot.js'

export type MenuStatus = {
  publishedVersion: number | null
  publishedAt: string | null
  hasUnpublishedChanges: boolean
}

/** Whether the live menu differs from the latest published snapshot (sold-out flags are not part of the hash). */
export async function menuStatus(sql: postgres.Sql): Promise<MenuStatus> {
  const [latest] = await sql<{ version: string | number; body_hash: string; published_at: Date | string }[]>`
    select version, body_hash, published_at from menu_snapshots order by version desc limit 1`
  const current = hashBody(await buildSnapshotBody(sql))
  if (!latest) return { publishedVersion: null, publishedAt: null, hasUnpublishedChanges: true }
  return {
    publishedVersion: Number(latest.version),
    publishedAt: new Date(latest.published_at).toISOString(),
    hasUnpublishedChanges: latest.body_hash !== current,
  }
}
