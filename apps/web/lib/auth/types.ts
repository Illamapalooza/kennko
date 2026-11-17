export type StaffRole = 'owner' | 'barista'

export type StaffMember = {
  id: string
  email: string
  fullName: string
  role: StaffRole
  isActive: boolean
}
