'use client'

import { useTransition, useState } from 'react'
import { setStaffRole, setStaffActive } from '@/app/admin/staff/actions'
import type { StaffMember, StaffRole } from '@/lib/auth/types'

export function StaffRow({
  member,
  isSelf,
  isLastOwner,
  layout,
}: {
  member: StaffMember
  isSelf: boolean
  isLastOwner: boolean
  layout: 'card' | 'row'
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const run = (fn: () => Promise<void>) =>
    startTransition(async () => {
      setError(null)
      try {
        await fn()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Something went wrong')
      }
    })

  const controls = (
    <>
      <select
        value={member.role}
        disabled={pending || isLastOwner}
        onChange={(event) =>
          run(() => setStaffRole(member.id, event.target.value as StaffRole))
        }
      >
        <option value="barista">Barista</option>
        <option value="owner">Owner</option>
      </select>

      <button
        type="button"
        className="btn btn-secondary"
        disabled={pending || isLastOwner}
        onClick={() => run(() => setStaffActive(member.id, !member.isActive))}
      >
        {member.isActive ? 'Deactivate' : 'Reactivate'}
      </button>

      {isLastOwner ? <small>Last owner — cannot be changed</small> : null}
      {isSelf ? <small>This is you</small> : null}
      {error ? (
        <p className="admin-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  )

  if (layout === 'card') {
    return (
      <article className="section-card">
        <strong>{member.fullName}</strong>
        <p>{member.email}</p>
        <p>
          {member.role} · {member.isActive ? 'Active' : 'Deactivated'}
        </p>
        {controls}
      </article>
    )
  }

  return (
    <tr>
      <td>{member.fullName}</td>
      <td>{member.email}</td>
      <td>{member.role}</td>
      <td>{member.isActive ? 'Active' : 'Deactivated'}</td>
      <td>{controls}</td>
    </tr>
  )
}
