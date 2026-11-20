import { MAX_HELD_RETRY, type PushResponse, type SyncEvent } from '@kennko/core'
import type postgres from 'postgres'
import type { AppDeps } from '../create-app.js'
import { applyEvent, entityKeys, type Applied } from './apply.js'
import { parseEvent, type Envelope } from './schema.js'

type Tx = postgres.TransactionSql
type Result = PushResponse['results'][number]

const held = (reason: string): Applied => ({ result: 'held', reason, flags: [] })

/** Carries a held answer out of its savepoint so anything the handler wrote is rolled back. */
class Hold extends Error {
  constructor(readonly out: Applied) {
    super('held')
  }
}

/** One event in its own savepoint. A held answer or a thrown error leaves nothing behind. */
async function applyInSavepoint(tx: Tx, deviceId: string, event: SyncEvent, now: Date): Promise<Applied> {
  try {
    return (await tx.savepoint(async (sp) => {
      const out = await applyEvent(sp, deviceId, event, now)
      if (out.result === 'held') throw new Hold(out)
      return out
    })) as Applied
  } catch (err) {
    if (err instanceof Hold) return err.out
    return held(`invalid: ${err instanceof Error ? err.message : String(err)}`)
  }
}

type HeldRow = {
  id: string
  seq: string
  kind: Envelope['kind']
  payload: unknown
  staff_id: string | null
  occurred_at: Date
  entity_keys: string[]
  reason: string | null
}

/**
 * Retries this device's held events, oldest seq first. A row sharing an entity with an earlier row
 * that is still held stays held, so per-entity order survives. Returns how many rows came free.
 */
async function retryHeld(tx: Tx, deviceId: string, now: Date): Promise<number> {
  const rows = await tx<HeldRow[]>`
    select id, seq, kind, payload, staff_id, occurred_at, entity_keys, reason
    from sync_events where device_id = ${deviceId} and result = 'held'
    order by seq limit ${MAX_HELD_RETRY}`
  const blocked = new Set<string>()
  let freed = 0
  for (const row of rows) {
    if (row.entity_keys.some((k) => blocked.has(k))) {
      for (const k of row.entity_keys) blocked.add(k)
      continue
    }
    const parsed = parseEvent({
      id: row.id,
      seq: Number(row.seq),
      kind: row.kind,
      occurredAt: row.occurred_at.toISOString(),
      staffId: row.staff_id,
      payload: row.payload,
    })
    const out = parsed.ok ? await applyInSavepoint(tx, deviceId, parsed.event, now) : held(parsed.reason)
    if (out.result === 'held') {
      for (const k of row.entity_keys) blocked.add(k)
      if (out.reason !== row.reason) {
        await tx`update sync_events set reason = ${out.reason} where device_id = ${deviceId} and id = ${row.id}`
      }
      continue
    }
    await tx`update sync_events set result = ${out.result}, reason = ${out.reason}, applied_at = ${now}
      where device_id = ${deviceId} and id = ${row.id}`
    freed += 1
  }
  return freed
}

/**
 * Applies a push from one till. One transaction holds the device's advisory lock for the whole
 * request (Ruling 2); every event runs in its own savepoint and gets a `sync_events` receipt, so a
 * retried or concurrent push answers `duplicate` instead of applying anything twice.
 */
export async function pushEvents(deps: AppDeps, deviceId: string, raw: Envelope[]): Promise<PushResponse> {
  const now = deps.now()
  return (await deps.sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`sync:${deviceId}`}, 0))`
    await retryHeld(tx, deviceId, now)

    const results: Result[] = []
    let anyApplied = false
    for (const env of raw) {
      const [seen] = await tx`select 1 from sync_events where device_id = ${deviceId} and id = ${env.id}`
      if (seen) {
        results.push({ id: env.id, result: 'duplicate', reason: null, flags: [] })
        continue
      }

      const keys = entityKeys(env)
      const parsed = parseEvent(env)
      let out: Applied
      if (!parsed.ok) {
        out = held(parsed.reason)
      } else if (keys.length > 0 && (await waitsForEarlier(tx, deviceId, env.seq, keys))) {
        out = held('waits_for_earlier')
      } else {
        out = await applyInSavepoint(tx, deviceId, parsed.event, now)
      }
      if (out.result !== 'held') anyApplied = true

      await tx`
        insert into sync_events (device_id, id, seq, kind, payload, staff_id, entity_keys, occurred_at,
          received_at, result, reason, applied_at)
        values (${deviceId}, ${env.id}, ${env.seq}, ${env.kind}, ${JSON.stringify(env.payload ?? null)}::text::jsonb,
          ${env.staffId}, ${keys}::text[], ${env.occurredAt}, ${now}, ${out.result}, ${out.reason},
          ${out.result === 'held' ? null : now})`
      results.push({ id: env.id, result: out.result, reason: out.reason, flags: out.flags })
    }

    // What this push brought (a shift, an order) may free events held earlier.
    if (anyApplied) await retryHeld(tx, deviceId, now)

    const [{ n }] = await tx<{ n: number }[]>`
      select count(*)::int as n from sync_events where device_id = ${deviceId} and result = 'held'`
    return { results, held: n }
  })) as PushResponse
}

async function waitsForEarlier(tx: Tx, deviceId: string, seq: number, keys: string[]): Promise<boolean> {
  const [row] = await tx`
    select 1 from sync_events
    where device_id = ${deviceId} and result = 'held' and seq < ${seq} and entity_keys && ${keys}::text[]
    limit 1`
  return Boolean(row)
}
