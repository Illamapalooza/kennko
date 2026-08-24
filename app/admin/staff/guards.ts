import type { StaffRole } from '@/lib/auth/types'

export type RoleRow = { id: string; role: StaffRole }

/**
 * Guards against the owner demoting or deactivating themselves into a state
 * where nobody can edit the menu. Recovering from that needs a script run
 * against the database, so it is blocked rather than warned about.
 */
export function canDemote(staff: RoleRow[], targetId: string): boolean {
  const target = staff.find((s) => s.id === targetId)
  if (!target || target.role !== 'owner') return true
  return staff.filter((s) => s.role === 'owner').length > 1
}
