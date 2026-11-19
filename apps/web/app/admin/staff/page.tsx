import { requireOwner } from '@/lib/auth/session'
import { getServerClient } from '@/lib/supabase/server'
import { inviteStaff } from './actions'
import { StaffRow } from '@/components/admin/StaffRow'
import type { StaffRole } from '@/lib/auth/types'

type Row = {
  id: string
  email: string
  full_name: string
  role: StaffRole
  is_active: boolean
}

export default async function StaffPage() {
  const currentUser = await requireOwner()
  const db = await getServerClient()

  const { data } = await db
    .from('staff')
    .select('id, email, full_name, role, is_active')
    .order('created_at')

  const staff = (data ?? []) as Row[]
  const ownerCount = staff.filter((s) => s.role === 'owner' && s.is_active).length

  const toMember = (row: Row) => ({
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active,
  })

  return (
    <>
      <h1>Staff</h1>

      <form action={inviteStaff} className="section-card">
        <h2>Invite someone</h2>
        <label className="admin-field">
          <span>Full name</span>
          <input name="full_name" required />
        </label>
        <label className="admin-field">
          <span>Email</span>
          <input name="email" type="email" required />
        </label>
        <label className="admin-field">
          <span>Role</span>
          <select name="role" defaultValue="barista">
            <option value="barista">Barista</option>
            <option value="owner">Owner</option>
          </select>
        </label>
        <button className="btn btn-primary" type="submit">
          Send invite
        </button>
      </form>

      <div className="admin-cards">
        {staff.map((member) => (
          <StaffRow
            key={member.id}
            member={toMember(member)}
            isSelf={member.id === currentUser.id}
            isLastOwner={member.role === 'owner' && ownerCount <= 1}
            layout="card"
          />
        ))}
      </div>

      <table className="admin-table staff-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Active</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {staff.map((member) => (
            <StaffRow
              key={member.id}
              member={toMember(member)}
              isSelf={member.id === currentUser.id}
              isLastOwner={member.role === 'owner' && ownerCount <= 1}
              layout="row"
            />
          ))}
        </tbody>
      </table>
    </>
  )
}
