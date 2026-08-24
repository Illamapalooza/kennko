import Link from 'next/link'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getCurrentStaff } from '@/lib/auth/session'
import { SignOutButton } from '@/components/admin/SignOutButton'
import './admin.css'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // The login page renders inside this layout but must not require a session.
  const pathname = (await headers()).get('x-pathname') ?? ''
  const staff = await getCurrentStaff()

  if (!staff) {
    if (pathname.startsWith('/admin/login')) return <>{children}</>
    redirect('/admin/login')
  }

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <strong>Kennko Admin</strong>
        <nav className="admin-nav">
          <Link href="/admin/menu">Menu</Link>
          {staff.role === 'owner' ? <Link href="/admin/staff">Staff</Link> : null}
        </nav>
        <span>
          {staff.fullName} · {staff.role}
        </span>
        <SignOutButton />
      </header>
      <main className="admin-main">{children}</main>
    </div>
  )
}
