import type { PulledStaff } from '@kennko/core'
import type postgres from 'postgres'

/** Active staff who have a PIN: what a paired till needs to check PINs offline. Never email or user id. */
export async function readPinRoster(sql: postgres.Sql | postgres.TransactionSql): Promise<PulledStaff[]> {
  const rows = await sql<{ id: string; full_name: string; role: PulledStaff['role']; pin_hash: string }[]>`
    select id, full_name, role, pin_hash from staff
    where is_active and pin_hash is not null order by full_name, id`
  return rows.map((s) => ({ id: s.id, fullName: s.full_name, role: s.role, pinHash: s.pin_hash }))
}
