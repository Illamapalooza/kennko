import type postgres from 'postgres'
import { checkStaffPin, hashStaffPin, randomStaffPin } from '@kennko/core/staff-pin'
import type { StaffRole } from '../auth.js'
import { apiError } from '../http.js'

export type StaffView = {
  id: string
  fullName: string
  email: string | null
  role: StaffRole
  isActive: boolean
  hasLogin: boolean
  pinSet: boolean
  pinUpdatedAt: string | null
}

export type StaffRow = {
  id: string
  full_name: string
  email: string | null
  role: StaffRole
  is_active: boolean
  user_id: string | null
  pin_hash: string | null
  pin_updated_at: Date | null
}

/** Never exposes `pin_hash` or `user_id`. */
export function toStaffView(r: StaffRow): StaffView {
  return {
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    role: r.role,
    isActive: r.is_active,
    hasLogin: r.user_id !== null,
    pinSet: r.pin_hash !== null,
    pinUpdatedAt: r.pin_updated_at?.toISOString() ?? null,
  }
}

/** Arbitrary fixed key so PIN issuing is serialised: two people cannot be handed the same PIN. */
const PIN_LOCK = 7_204_002
const PIN_TRIES = 10

/**
 * Generates a PIN for an active person that matches no other active person's PIN, stores its hash,
 * and returns it. The PIN is never logged and is not stored anywhere in the clear.
 */
export async function issuePin(sql: postgres.Sql, staffId: string, now: Date = new Date()): Promise<string> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${PIN_LOCK})`
    const [target] = await tx<{ is_active: boolean }[]>`select is_active from staff where id = ${staffId} for update`
    if (!target) throw apiError(404, 'NOT_FOUND', 'Not found')
    if (!target.is_active) throw apiError(409, 'INACTIVE', 'Reactivate this person before giving them a PIN.')

    const others = await tx<{ pin_hash: string }[]>`
      select pin_hash from staff where is_active and pin_hash is not null and id <> ${staffId}`
    for (let attempt = 0; attempt < PIN_TRIES; attempt++) {
      const pin = randomStaffPin()
      let taken = false
      for (const o of others) {
        if (await checkStaffPin(pin, o.pin_hash)) {
          taken = true
          break
        }
      }
      if (taken) continue
      await tx`update staff set pin_hash = ${await hashStaffPin(pin)}, pin_updated_at = ${now}, updated_at = ${now} where id = ${staffId}`
      return pin
    }
    throw apiError(503, 'PIN_BUSY', 'Could not make a PIN. Try again.')
  })
}
