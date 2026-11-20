import { requireOwner } from '@/lib/auth/session'
import { staffFetch } from '@/lib/api/client'
import { StaffRow, type StaffView } from '@/components/admin/StaffRow'
import { AddStaffForm } from '@/components/admin/AddStaffForm'

async function loadStaff(): Promise<{ staff: StaffView[] } | { error: string }> {
  try {
    const res = await staffFetch('/v1/staff')
    if (!res.ok) return { error: "Couldn't load staff. Refresh to try again." }
    const body = (await res.json()) as { staff?: StaffView[] }
    return { staff: body.staff ?? [] }
  } catch {
    return { error: "Couldn't reach the server. Refresh to try again." }
  }
}

export default async function StaffPage() {
  const currentUser = await requireOwner()
  const loaded = await loadStaff()
  const staff = 'staff' in loaded ? loaded.staff : []
  const ownerCount = staff.filter((s) => s.role === 'owner' && s.isActive).length

  return (
    <>
      <h1>Staff</h1>

      <AddStaffForm />

      {'error' in loaded ? (
        <p className="admin-error" role="alert">
          {loaded.error}
        </p>
      ) : null}

      <div className="admin-cards">
        {staff.map((member) => (
          <StaffRow
            key={member.id}
            member={member}
            isSelf={member.id === currentUser.id}
            isLastOwner={member.role === 'owner' && member.isActive && ownerCount <= 1}
            layout="card"
          />
        ))}
      </div>

      <table className="admin-table staff-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Website login</th>
            <th>Till PIN</th>
            <th>Active</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {staff.map((member) => (
            <StaffRow
              key={member.id}
              member={member}
              isSelf={member.id === currentUser.id}
              isLastOwner={member.role === 'owner' && member.isActive && ownerCount <= 1}
              layout="row"
            />
          ))}
        </tbody>
      </table>
    </>
  )
}
