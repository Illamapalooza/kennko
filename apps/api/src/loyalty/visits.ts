import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { MAX_VISITORS, parseLook, VISIT_MS, wallCode, wallMinute, WALL_CODE_LENGTH, type WallVisitor } from '@kennko/core'
import type postgres from 'postgres'

type Tx = postgres.TransactionSql
type Sql = postgres.Sql | postgres.TransactionSql

const WALL_CODE = new RegExp(`^[a-z2-7]{${WALL_CODE_LENGTH}}$`)

/**
 * The wall check-in secret (Ruling 5): row 1, created on first use as 32 random bytes in base64url. Two first pulls at
 * once both insert with `on conflict do nothing` and then read the same row. `now` stamps `rotated_at`.
 */
export async function checkinSecret(sql: Sql, now: Date): Promise<string> {
  const read = async () =>
    (await sql<{ checkin_secret: string }[]>`select checkin_secret from shop_secrets where id = 1`)[0]?.checkin_secret
  const found = await read()
  if (found !== undefined) return found
  await sql`
    insert into shop_secrets (id, checkin_secret, rotated_at)
    values (1, ${randomBytes(32).toString('base64url')}, ${now})
    on conflict do nothing`
  const made = await read()
  if (made === undefined) throw new Error('shop_secrets row 1 missing after insert')
  return made
}

/**
 * Whether `code` is the wall's code for the minute holding `now` or the minute before it (never a later minute).
 * Anything that is not 8 lower-case base32 characters is refused before any hashing; the comparison itself is
 * constant-time on equal-length buffers.
 */
export async function codeMatches(secret: string, code: string, now: Date): Promise<boolean> {
  if (!WALL_CODE.test(code)) return false
  const given = Buffer.from(code, 'utf8')
  const m = wallMinute(now.getTime())
  let match = false
  for (const minute of [m, m - 1]) {
    const want = Buffer.from(await wallCode(secret, minute), 'utf8')
    // Both sides are 8 ASCII characters; check anyway, as timingSafeEqual throws on a length mismatch.
    if (want.length === given.length && timingSafeEqual(want, given)) match = true
  }
  return match
}

/**
 * A check-in (Ruling 7): a visit that has ended (or none) starts over with a new key and `started_at = now`; an active
 * one keeps both. Either way the end becomes the later of the current end and `now + 90 min`. The caller holds the
 * customer lock. Answers the new end.
 */
export async function startOrExtendVisit(tx: Tx, customerId: string, now: Date): Promise<Date> {
  const end = new Date(now.getTime() + VISIT_MS)
  const [row] = await tx<{ ends_at: Date }[]>`
    insert into visits as v (customer_id, visit_key, source, started_at, ends_at)
    values (${customerId}, ${randomUUID()}, 'checkin', ${now}, ${end})
    on conflict (customer_id) do update set
      visit_key  = case when v.ends_at <= ${now}::timestamptz then excluded.visit_key else v.visit_key end,
      started_at = case when v.ends_at <= ${now}::timestamptz then excluded.started_at else v.started_at end,
      ends_at    = greatest(v.ends_at, excluded.ends_at),
      source     = 'checkin'
    returning ends_at`
  return row!.ends_at
}

/**
 * A counter sale linked to the card (Ruling 8): extends a visit that is still on at `now` to at least `now + 90 min`,
 * only while the cat's "Show me on the wall" is on. Never starts a visit; an ended one is left alone. The caller holds
 * the order and customer locks.
 */
export async function extendActiveVisit(tx: Tx, customerId: string, now: Date): Promise<void> {
  const end = new Date(now.getTime() + VISIT_MS)
  await tx`
    update visits set ends_at = greatest(ends_at, ${end}::timestamptz)
    where customer_id = ${customerId} and ends_at > ${now}
      and exists (select 1 from cats where cats.customer_id = ${customerId} and cats.show_on_wall)`
}

/**
 * The cats on the wall at `now` (Ruling 9): visits still on, cats shown and not hidden by Kennko, the most recent
 * arrivals first, at most `MAX_VISITORS`. Only the per-visit key, the cat name, the look and the end time leave here;
 * a row whose stored look does not parse is skipped.
 */
export async function readVisitors(sql: Sql, now: Date): Promise<WallVisitor[]> {
  const rows = await sql<{ visit_key: string; name: string; equipped: unknown; ends_at: Date }[]>`
    select v.visit_key, c.name, c.equipped, v.ends_at
    from visits v join cats c on c.customer_id = v.customer_id
    where v.ends_at > ${now} and c.show_on_wall and not c.hidden_by_admin
    order by v.started_at desc, v.customer_id
    limit ${MAX_VISITORS}`
  const out: WallVisitor[] = []
  for (const r of rows) {
    const look = parseLook(r.equipped)
    if (look) out.push({ key: r.visit_key, name: r.name, look, endsAt: r.ends_at.toISOString() })
  }
  return out
}
