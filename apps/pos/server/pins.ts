import { createHash, timingSafeEqual } from 'node:crypto'
import { checkStaffPin, isStaffPin } from '@kennko/core/staff-pin'
import type { Who } from './sessions.ts'

/**
 * off: no PIN to open the till. shared: the two PINs in config.json. per-person: each person's own 6-digit PIN,
 * checked against the staff cache; on once the cache holds an owner or manager, so the till is never left without
 * someone who can void or close.
 */
export type PinMode = 'off' | 'shared' | 'per-person'

/** A person the till may let in, as cached from the Kennko API. */
export type CachedStaff = { id: string; fullName: string; role: 'owner' | 'manager' | 'barista'; pinHash: string }

/** Compares in constant time, so the time taken says nothing about how much of a PIN was right. */
function same(given: string, expected: string): boolean {
  if (!given || !expected) return false
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * Answers "whose PIN is this?" for the till. Async so per-person mode can check scrypt hashes; nothing here waits
 * on the network. The strike lockout lives in index.ts and wraps both checks.
 */
export function createPinDirectory(opts: { staffPin: string; managerPin: string; staff: () => CachedStaff[] }) {
  const sharedWho = (role: Who['role']): Who => ({ staffId: null, name: null, role })
  const leads = (s: CachedStaff) => s.role === 'owner' || s.role === 'manager'
  const personWho = (s: CachedStaff): Who => ({ staffId: s.id, name: s.fullName, role: s.role === 'barista' ? 'staff' : 'manager' })

  /** The first cached person whose hash matches. The API never issues one PIN to two active people (Ruling 5). */
  async function findPerson(pin: string, rows: CachedStaff[]): Promise<Who | null> {
    if (!isStaffPin(pin)) return null
    for (const s of rows) if (await checkStaffPin(pin, s.pinHash)) return personWho(s)
    return null
  }

  const mode = (staff: CachedStaff[]): PinMode => (staff.some(leads) ? 'per-person' : opts.staffPin ? 'shared' : 'off')

  return {
    mode: (): PinMode => mode(opts.staff()),

    /** The PIN that opens the till on a device. */
    async checkGate(pin: string): Promise<Who | null> {
      const staff = opts.staff()
      if (mode(staff) === 'per-person') return findPerson(pin, staff)
      if (same(pin, opts.managerPin)) return sharedWho('manager')
      if (same(pin, opts.staffPin)) return sharedWho('staff')
      return null
    },

    /** The PIN for voids, cash out, closing the till and updating the menu. */
    async checkManager(pin: string): Promise<Who | null> {
      const staff = opts.staff()
      if (mode(staff) === 'per-person') return findPerson(pin, staff.filter(leads))
      return same(pin, opts.managerPin) ? sharedWho('manager') : null
    },
  }
}

export type PinDirectory = ReturnType<typeof createPinDirectory>
