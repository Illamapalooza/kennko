import type postgres from 'postgres'
import { parseLook, type CatLook } from '@kennko/core'
import { checkStaffPin, hashStaffPin, isStaffPin, randomStaffPin } from '@kennko/core/staff-pin'
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
  catLook: CatLook | null
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
  cat_look?: unknown
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
    catLook: r.cat_look ? parseLook(r.cat_look) : null,
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

/**
 * Lets a signed-in staff member change their own 6-digit till PIN from a paired POS.
 * Verifies the current PIN, ensures the new PIN is not already used by another active staff member,
 * stores the new scrypt hash, and returns it so the till can update its local staff cache immediately.
 */
export async function changeOwnPin(
  sql: postgres.Sql,
  input: { staffId: string; currentPin: string; newPin: string; now?: Date },
): Promise<{ pinHash: string }> {
  const { staffId, currentPin, newPin } = input
  const now = input.now ?? new Date()
  if (!isStaffPin(currentPin) || !isStaffPin(newPin)) {
    throw apiError(400, 'INVALID_PIN', 'PINs must be 6 digits.')
  }
  if (currentPin === newPin) {
    throw apiError(400, 'SAME_PIN', 'Pick a new 6-digit PIN different from your current one.')
  }
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${PIN_LOCK})`
    const [target] = await tx<{ is_active: boolean; pin_hash: string | null }[]>`
      select is_active, pin_hash from staff where id = ${staffId} for update`
    if (!target) throw apiError(404, 'NOT_FOUND', 'Staff account not found.')
    if (!target.is_active) throw apiError(409, 'INACTIVE', 'This staff account is inactive.')
    if (!target.pin_hash || !(await checkStaffPin(currentPin, target.pin_hash))) {
      throw apiError(401, 'WRONG_PIN', 'Current PIN is wrong.')
    }

    const others = await tx<{ pin_hash: string }[]>`
      select pin_hash from staff where is_active and pin_hash is not null and id <> ${staffId}`
    for (const o of others) {
      if (await checkStaffPin(newPin, o.pin_hash)) {
        throw apiError(409, 'PIN_TAKEN', 'That PIN is already in use. Pick a different 6-digit PIN.')
      }
    }

    const pinHash = await hashStaffPin(newPin)
    await tx`update staff set pin_hash = ${pinHash}, pin_updated_at = ${now}, updated_at = ${now} where id = ${staffId}`
    return { pinHash }
  })
}
