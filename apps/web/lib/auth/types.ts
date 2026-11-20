export type StaffRole = 'owner' | 'manager' | 'barista'

export type StaffMember = {
  id: string
  email: string | null
  fullName: string
  role: StaffRole
  isActive: boolean
}
