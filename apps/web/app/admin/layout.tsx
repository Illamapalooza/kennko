import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getCurrentStaff } from '@/lib/auth/session'
import { SignOutButton } from '@/components/admin/SignOutButton'
import { AdminNav } from '@/components/admin/AdminNav'
import { PublishBar } from '@/components/admin/PublishBar'
import { AutoRefresh } from '@/components/admin/AutoRefresh'
import { getMenuStatus, type MenuStatus } from '@/lib/menu/status'
import { countOrdersToCheck } from '@/lib/admin/overview-data'
import './admin.css'

export const dynamic = 'force-dynamic'

// Installing from any admin page installs the admin app (its own scope and start page), not the website.
export const metadata: Metadata = {
  manifest: '/admin/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Kennko Admin', statusBarStyle: 'default' },
}

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
  if (isLoginRoute) redirect('/admin')

  const isOwner = staff.role === 'owner'
  // Chrome data fails soft: a broken count must not take down every admin page.
  const [ordersToCheck, status] = await Promise.all([
    countOrdersToCheck().catch((e) => {
      console.error('admin layout: orders count failed', e)
      return 0
    }),
    getMenuStatus().catch((): MenuStatus => ({ ok: false })),
  ])

  return (
    <div className="admin-shell">
      <AutoRefresh />
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
