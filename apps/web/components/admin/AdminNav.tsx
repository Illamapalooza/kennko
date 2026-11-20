'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { StaffRole } from '@/lib/auth/types'

type AdminNavProps = { ordersToCheck: number; role: StaffRole; attentionCount?: number }

type NavLink = { href: string; label: string; exact?: boolean; minRole?: 'manager' | 'owner' }

const LINKS: NavLink[] = [
  { href: '/admin', label: 'Overview', exact: true },
  { href: '/admin/orders', label: 'Orders' },
  { href: '/admin/customers', label: 'Customers', minRole: 'manager' },
  { href: '/admin/reports', label: 'Reports', minRole: 'manager' },
  { href: '/admin/menu', label: 'Menu' },
  { href: '/admin/staff', label: 'Staff', minRole: 'owner' },
  { href: '/admin/devices', label: 'Tills', minRole: 'owner' },
  { href: '/admin/attention', label: 'Needs a look', minRole: 'owner' },
]

const RANK: Record<StaffRole, number> = { barista: 0, manager: 1, owner: 2 }
const visible = (link: NavLink, role: StaffRole) => !link.minRole || RANK[role] >= RANK[link.minRole]

export function AdminNav({ ordersToCheck, role, attentionCount = 0 }: AdminNavProps) {
  const pathname = usePathname()

  return (
    <nav className="admin-nav" aria-label="Admin">
      {LINKS.filter((l) => visible(l, role)).map((link) => {
        const active = link.exact
          ? pathname === link.href
          : pathname === link.href || pathname.startsWith(`${link.href}/`)
        return (
          <Link
            key={link.href}
            href={link.href}
            className="admin-nav-link"
            aria-current={active ? 'page' : undefined}
          >
            {link.label}
            {link.href === '/admin/orders' && ordersToCheck > 0 ? (
              <span className="admin-nav-badge">{ordersToCheck}</span>
            ) : null}
            {link.href === '/admin/attention' && attentionCount > 0 ? (
              <span className="admin-nav-badge" aria-label={`${attentionCount} need a look`}>
                {attentionCount}
              </span>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}
