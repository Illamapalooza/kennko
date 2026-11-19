'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type AdminNavProps = { ordersToCheck: number; isOwner: boolean }

type NavLink = { href: string; label: string; exact?: boolean; ownerOnly?: boolean }

const LINKS: NavLink[] = [
  { href: '/admin', label: 'Overview', exact: true },
  { href: '/admin/orders', label: 'Orders' },
  { href: '/admin/menu', label: 'Menu' },
  { href: '/admin/staff', label: 'Staff', ownerOnly: true },
]

export function AdminNav({ ordersToCheck, isOwner }: AdminNavProps) {
  const pathname = usePathname()

  return (
    <nav className="admin-nav" aria-label="Admin">
      {LINKS.filter((l) => isOwner || !l.ownerOnly).map((link) => {
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
          </Link>
        )
      })}
    </nav>
  )
}
