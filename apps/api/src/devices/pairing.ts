import type postgres from 'postgres'
import { newDeviceToken, sha256Hex } from './tokens.js'

export const PAIRING_TTL_MS = 600_000
export const MAX_PAIRING_ATTEMPTS = 5

export type PairResult = { deviceId: string; name: string; ticketSeries: 'C'; token: string }

/**
 * Redeems a pairing code. One conditional update is the whole guarantee: a code works once, only
 * before it expires, and never after revoke. A miss counts one attempt against every live code
 * (a wrong code cannot say which device it was meant for) and burns codes at the limit.
 */
export async function pairDevice(sql: postgres.Sql, code: string, now: Date): Promise<PairResult | null> {
  const token = newDeviceToken()
  const [row] = await sql<{ id: string; name: string }[]>`
    update devices set token_hash = ${sha256Hex(token)}, pairing_code_hash = null, paired_at = ${now},
      pairing_attempts = 0, updated_at = ${now}
    where pairing_code_hash = ${sha256Hex(code)} and pairing_expires_at > ${now}
      and paired_at is null and revoked_at is null
    returning id, name`
  if (row) return { deviceId: row.id, name: row.name, ticketSeries: 'C', token }

  await sql`
    update devices set pairing_attempts = pairing_attempts + 1, updated_at = ${now},
      pairing_code_hash = case when pairing_attempts + 1 >= ${MAX_PAIRING_ATTEMPTS} then null else pairing_code_hash end
    where pairing_code_hash is not null and pairing_expires_at > ${now}`
  return null
}
