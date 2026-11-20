'use client'

import { useRef, useState, useTransition } from 'react'
import { addStaff } from '@/app/admin/staff/actions'
import type { StaffRole } from '@/lib/auth/types'

export function AddStaffForm() {
  const formRef = useRef<HTMLFormElement>(null)
  const [role, setRole] = useState<StaffRole>('barista')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const showEmail = role !== 'barista'

  return (
    <form
      ref={formRef}
      className="section-card"
      action={(formData) =>
        startTransition(async () => {
          setError(null)
          const result = await addStaff(formData)
          if (result.ok) {
            formRef.current?.reset()
            setRole('barista')
          } else {
            setError(result.message)
          }
        })
      }
    >
      <h2>Add someone</h2>
      <label className="admin-field">
        <span>Full name</span>
        <input name="full_name" required />
      </label>
      <label className="admin-field">
        <span>Role</span>
        <select name="role" value={role} onChange={(event) => setRole(event.target.value as StaffRole)}>
          <option value="barista">Barista</option>
          <option value="manager">Manager</option>
          <option value="owner">Owner</option>
        </select>
      </label>
      {showEmail ? (
        <label className="admin-field">
          <span>{role === 'owner' ? 'Email' : 'Email (optional)'}</span>
          <input name="email" type="email" required={role === 'owner'} />
        </label>
      ) : (
        <p>Baristas don&apos;t need an email. Give them a PIN for the till.</p>
      )}
      {error ? (
        <p className="admin-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {showEmail ? 'Send invite' : 'Add'}
      </button>
    </form>
  )
}
