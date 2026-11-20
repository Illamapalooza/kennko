import type postgres from 'postgres'

const MINUTE_MS = 60_000
/** Windows older than this are deleted when the key is next hit. */
const KEEP_MS = 10 * MINUTE_MS

/**
 * Counts one hit for `key` in the minute window holding `now` and answers whether it is within `limit`. The count
 * lives in `rate_limits` because the serverless API instances share no memory (Ruling 20). The key's windows older
 * than 10 minutes are deleted on the same call.
 */
export async function hit(sql: postgres.Sql | postgres.TransactionSql, key: string, limit: number, now: Date): Promise<boolean> {
  const windowStart = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS)
  const [row] = await sql<{ hits: number }[]>`
    insert into rate_limits (key, window_start, hits) values (${key}, ${windowStart}, 1)
    on conflict (key, window_start) do update set hits = rate_limits.hits + 1
    returning hits`
  await sql`delete from rate_limits where key = ${key} and window_start < ${new Date(windowStart.getTime() - KEEP_MS)}`
  return row!.hits <= limit
}
