import { MAX_HELD_RETRY, type PushResponse, type SyncEvent } from '@kennko/core'
import type postgres from 'postgres'
import type { AppDeps } from '../create-app.js'
import { applyEvent, entityKeys, type Applied } from './apply.js'
import { clip, findNul, parseEvent, storableTime, type Envelope } from './schema.js'

type Tx = postgres.TransactionSql
type Result = PushResponse['results'][number]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const held = (reason: string): Applied => ({ result: 'held', reason, flags: [] })
/**
 * Held because of what was sent (a payload, time or staff id that fails validation, or a receipt
 * Postgres refused): retrying cannot change it. Apply-time exceptions are held `error: …` instead and
 * are retried, since a deploy or a change in the data can clear them.
 */
const isPermanent = (reason: string | null) => reason !== null && reason.startsWith('invalid:')
const messageOf = (err: unknown) => clip(err instanceof Error ? err.message : String(err))

/**
 * Errors the till should simply send again: SQLSTATE class 40 (serialization, deadlock), 57
 * (timeout, cancel, shutdown), 08 (connection), 53 (out of resources, too many connections), 55P03
 * (lock not available), and postgres.js's own connection errors. These fail the whole push.
 */
export function isRetryable(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  if (typeof code !== 'string') return false
  return /^(40|57|08|53)[0-9A-Z]{3}$/.test(code) || code === '55P03' || code.startsWith('CONNECT')
}

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
    if (isRetryable(err)) throw err
    return held(`error: ${messageOf(err)}`)
  }
}

/** The payload as jsonb text. One holding U+0000 (which jsonb rejects) is kept as a JSON string of its JSON text. */
function payloadJson(payload: unknown): string {
  const text = JSON.stringify(payload ?? null)
  return findNul(payload) ? JSON.stringify(text) : text
}

async function insertReceipt(
  tx: Tx,
  deviceId: string,
  env: Envelope,
  keys: string[],
  payload: string,
  out: Applied,
  now: Date,
): Promise<void> {
  // A time or staff id Postgres cannot take was already answered invalid; the receipt records the receive time / null.
  const occurredAt = storableTime(env.occurredAt) ?? now
  const staffId = env.staffId !== null && UUID.test(env.staffId) ? env.staffId : null
  await tx`
    insert into sync_events (device_id, id, seq, kind, payload, staff_id, entity_keys, occurred_at,
      received_at, result, reason, applied_at)
    values (${deviceId}, ${env.id}, ${env.seq}, ${env.kind}, ${payload}::text::jsonb, ${staffId}, ${keys}::text[],
      ${occurredAt}, ${now}, ${out.result}, ${out.reason}, ${out.result === 'held' ? null : now})`
}

/**
 * A new event: validate, wait behind an earlier held event on the same entity, or apply; then its
 * receipt. Apply and receipt share a savepoint, so if Postgres refuses the receipt the event's
 * effects roll back too, and a fallback receipt (`invalid: receipt`) is kept instead. Nothing a till
 * sends can make the push fail, except a retryable database error.
 */
async function recordEvent(tx: Tx, deviceId: string, env: Envelope, now: Date): Promise<Applied> {
  try {
    return (await tx.savepoint(async (sp) => {
      const keys = entityKeys(env)
      const parsed = parseEvent(env)
      let out: Applied
      if (!parsed.ok) out = held(parsed.reason)
      else if (keys.length > 0 && (await waitsForEarlier(sp, deviceId, env.seq, keys))) out = held('waits_for_earlier')
      else out = await applyInSavepoint(sp, deviceId, parsed.event, now)
      await insertReceipt(sp, deviceId, env, keys, payloadJson(env.payload), out, now)
      return out
    })) as Applied
  } catch (err) {
    if (isRetryable(err)) throw err
    const out = held(`invalid: receipt: ${messageOf(err)}`)
    // Keys stay so later events on the same entity still wait; keys and payload are made safe to store.
    const keys = entityKeys(env).filter((k) => !k.includes('\u0000'))
    await insertReceipt(tx, deviceId, env, keys, JSON.stringify(JSON.stringify(env.payload ?? null)), out, now)
    return out
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
 * that is still held stays held, so per-entity order survives. A row held `invalid: …` is never
 * applied again (what was sent cannot change); it only keeps its place in line. Rows held
 * `error: …` are retried like any other.
 */
async function retryHeld(tx: Tx, deviceId: string, now: Date): Promise<void> {
  const rows = await tx<HeldRow[]>`
    select id, seq, kind, payload, staff_id, occurred_at, entity_keys, reason
    from sync_events where device_id = ${deviceId} and result = 'held'
    order by seq limit ${MAX_HELD_RETRY}`
  const blocked = new Set<string>()
  for (const row of rows) {
    if (isPermanent(row.reason) || row.entity_keys.some((k) => blocked.has(k))) {
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
  }
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
      const out = await recordEvent(tx, deviceId, env, now)
      if (out.result !== 'held') anyApplied = true
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
