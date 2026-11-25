'use client'

import { useTransition, useState } from 'react'
import type { CatLook } from '@kennko/core'
import { updateStaff, issuePin } from '@/app/admin/staff/actions'
import type { StaffRole } from '@/lib/auth/types'
import { StaffCatCustomizer } from './StaffCatCustomizer'

export type StaffView = {
  id: string
  fullName: string
  email: string | null
  role: StaffRole
  isActive: boolean
  hasLogin: boolean
  pinSet: boolean
  pinUpdatedAt: string | null
  catLook?: CatLook | null
}

function pinStatus(member: StaffView): string {
  if (!member.pinSet) return 'No PIN'
  if (!member.pinUpdatedAt) return 'PIN set'
  const when = new Date(member.pinUpdatedAt).toLocaleDateString('en-PH', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Manila',
  })
  return `PIN set ${when}`
}

/** 482913 -> "482 913" so it reads aloud in two halves. */
function spaced(pin: string): string {
  return pin.length === 6 ? `${pin.slice(0, 3)} ${pin.slice(3)}` : pin
}

export function StaffRow({
  member,
  isSelf,
  isLastOwner,
  layout,
}: {
  member: StaffView
  isSelf: boolean
  isLastOwner: boolean
  layout: 'card' | 'row'
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [shownPin, setShownPin] = useState<string | null>(null)
  const [editingCat, setEditingCat] = useState(false)

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      setError(null)
      const result = await fn()
      if (!result.ok) setError(result.message ?? 'Something went wrong. Try again.')
    })

  const makePin = () =>
    startTransition(async () => {
      setError(null)
      const result = await issuePin(member.id)
      if (result.ok) setShownPin(result.pin)
      else setError(result.message)
    })

  const controls = (
    <>
      <select
        aria-label={`Role for ${member.fullName}`}
        value={member.role}
        disabled={pending || isLastOwner}
        onChange={(event) => run(() => updateStaff(member.id, { role: event.target.value as StaffRole }))}
      >
        <option value="barista">Barista</option>
        <option value="manager">Manager</option>
        <option value="owner">Owner</option>
      </select>

      {member.isActive ? (
        <button type="button" className="btn btn-secondary" disabled={pending} onClick={makePin}>
          {member.pinSet ? 'New PIN' : 'Set PIN'}
        </button>
      ) : null}

      <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setEditingCat(true)}>
        Cat sprite
      </button>

      {editingCat ? (
        <StaffCatCustomizer
          staffName={member.fullName}
          initialLook={member.catLook ?? null}
          pending={pending}
          onClose={() => setEditingCat(false)}
          onSave={(catLook) =>
            run(async () => {
              const res = await updateStaff(member.id, { catLook })
              if (res.ok) setEditingCat(false)
              return res
            })
          }
        />
      ) : null}

      <button
        type="button"
        className="btn btn-secondary"
        disabled={pending || isLastOwner}
        onClick={() => run(() => updateStaff(member.id, { isActive: !member.isActive }))}
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
      {shownPin ? (
        <div className="staff-pin-reveal">
          <p>
            Tell {member.fullName} their till PIN: <strong className="staff-pin">{spaced(shownPin)}</strong>. It
            won&apos;t be shown again.
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => setShownPin(null)}>
            Done
          </button>
        </div>
      ) : null}
    </>
  )

  const login = member.hasLogin ? 'Yes' : 'No'

  if (layout === 'card') {
    return (
      <article className="section-card">
        <strong>{member.fullName}</strong>
        {member.email ? <p>{member.email}</p> : null}
        <p>
          {member.role} · {member.isActive ? 'Active' : 'Deactivated'}
        </p>
        <p>
          Website login: {login} · {pinStatus(member)}
        </p>
        {controls}
      </article>
    )
  }

  return (
    <tr>
      <td>
        {member.fullName}
        {member.email ? <small> {member.email}</small> : null}
      </td>
      <td>{member.role}</td>
      <td>{login}</td>
      <td>{pinStatus(member)}</td>
      <td>
        <span className={member.isActive ? 'staff-pill is-active' : 'staff-pill'}>
          {member.isActive ? 'Active' : 'Deactivated'}
        </span>
      </td>
      <td>{controls}</td>
    </tr>
  )
}
