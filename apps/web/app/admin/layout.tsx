import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getCurrentStaff } from '@/lib/auth/session'
import { SignOutButton } from '@/components/admin/SignOutButton'
import { AdminNav } from '@/components/admin/AdminNav'
import { PublishBar } from '@/components/admin/PublishBar'
import { getMenuStatus } from '@/lib/menu/status'
import { countOrdersToCheck } from '@/lib/admin/overview-data'
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

  const isLoginRoute = pathname.startsWith('/admin/login')

  if (!staff) {
    if (isLoginRoute) return <>{children}</>
    redirect('/admin/login')
  }

  // Someone already signed in has no use for the sign-in form, and rendering
  // it inside the admin chrome puts a Sign in and a Sign out button on screen
  // at once.
  if (isLoginRoute) redirect('/admin/menu')

  const isOwner = staff.role === 'owner'
  const [ordersToCheck, status] = await Promise.all([countOrdersToCheck(), getMenuStatus()])

  return (
    <div className="admin-shell">
      <aside className="admin-side">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="admin-wordmark" src="/brand/wordmark-white.png" alt="Kennko Coffee" />
        <AdminNav ordersToCheck={ordersToCheck} isOwner={isOwner} />
        <div className="admin-user">
          <span>
            {staff.fullName} · {staff.role}
          </span>
          <SignOutButton />
        </div>
      </aside>
      <div className="admin-column">
        <main className="admin-main">{children}</main>
        <PublishBar status={status} isOwner={isOwner} />
      </div>
    </div>
  )
}
