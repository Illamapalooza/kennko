import { createHash, timingSafeEqual } from 'node:crypto'
import type { Who } from './sessions.ts'

/** off: no PIN to open the till. shared: the two PINs in config.json. per-person: each person's own PIN (Task 9). */
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
  return {
    mode(): PinMode {
      return opts.staffPin ? 'shared' : 'off'
    },

    /** The PIN that opens the till on a device. */
    async checkGate(pin: string): Promise<Who | null> {
      if (same(pin, opts.managerPin)) return sharedWho('manager')
      if (same(pin, opts.staffPin)) return sharedWho('staff')
      return null
    },

    /** The PIN for voids, cash out, closing the till and updating the menu. */
    async checkManager(pin: string): Promise<Who | null> {
      return same(pin, opts.managerPin) ? sharedWho('manager') : null
    },
  }
}

export type PinDirectory = ReturnType<typeof createPinDirectory>
