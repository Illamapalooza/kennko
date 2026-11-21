import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let path = '/admin'
vi.mock('next/navigation', () => ({ usePathname: () => path }))

import { AdminNav } from './AdminNav'

describe('AdminNav', () => {
  it('marks the active link', () => {
    path = '/admin/menu/new'
    render(<AdminNav ordersToCheck={0} role="owner" />)
    expect(screen.getByRole('link', { name: 'Menu' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBeNull()
  })

  it('only marks Overview on exactly /admin', () => {
    path = '/admin'
    render(<AdminNav ordersToCheck={0} role="owner" />)
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page')
  })

  it('hides Staff from a barista', () => {
    path = '/admin'
    render(<AdminNav ordersToCheck={0} role="barista" />)
    expect(screen.queryByRole('link', { name: 'Staff' })).toBeNull()
  })

  it('shows Staff to an owner', () => {
    path = '/admin'
    render(<AdminNav ordersToCheck={0} role="owner" />)
    expect(screen.getByRole('link', { name: 'Staff' }).getAttribute('href')).toBe('/admin/staff')
  })

  it('shows Tills to an owner and hides it from everyone else', () => {
    path = '/admin'
    const { unmount } = render(<AdminNav ordersToCheck={0} role="owner" />)
    expect(screen.getByRole('link', { name: 'Tills' }).getAttribute('href')).toBe('/admin/devices')
    unmount()
    render(<AdminNav ordersToCheck={0} role="barista" />)
    expect(screen.queryByRole('link', { name: 'Tills' })).toBeNull()
  })

  it('shows a badge with the count of orders waiting', () => {
    path = '/admin'
    render(<AdminNav ordersToCheck={2} role="owner" />)
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('shows no badge at zero', () => {
    path = '/admin'
    render(<AdminNav ordersToCheck={0} role="owner" />)
    expect(screen.queryByText('0')).toBeNull()
  })

  it('shows Reports to a manager but not Staff, Tills or Needs a look', () => {
    path = '/admin'
    render(<AdminNav ordersToCheck={0} role="manager" attentionCount={3} />)
    expect(screen.getByRole('link', { name: 'Reports' }).getAttribute('href')).toBe('/admin/reports')
    expect(screen.queryByRole('link', { name: 'Staff' })).toBeNull()
    expect(screen.queryByRole('link', { name: /Needs a look/ })).toBeNull()
  })

  it('shows Customers to a manager, after Orders, and hides it from a barista', () => {
    path = '/admin'
    const { unmount } = render(<AdminNav ordersToCheck={0} role="manager" />)
    const names = screen.getAllByRole('link').map((l) => l.textContent)
    expect(screen.getByRole('link', { name: 'Customers' }).getAttribute('href')).toBe('/admin/customers')
    expect(names.indexOf('Customers')).toBe(names.indexOf('Orders') + 1)
    unmount()
    render(<AdminNav ordersToCheck={0} role="barista" />)
    expect(screen.queryByRole('link', { name: 'Customers' })).toBeNull()
  })

  it('hides Reports from a barista', () => {
    path = '/admin'
    render(<AdminNav ordersToCheck={0} role="barista" />)
    expect(screen.queryByRole('link', { name: 'Reports' })).toBeNull()
  })

  it('shows Needs a look to the owner with a badge when something waits', () => {
    path = '/admin'
    render(<AdminNav ordersToCheck={0} role="owner" attentionCount={4} />)
    const link = screen.getByRole('link', { name: /Needs a look/ })
    expect(link.getAttribute('href')).toBe('/admin/attention')
    expect(link.textContent).toContain('4')
  })

  it('shows no attention badge at zero', () => {
    path = '/admin'
    render(<AdminNav ordersToCheck={0} role="owner" attentionCount={0} />)
    expect(screen.getByRole('link', { name: 'Needs a look' }).textContent).toBe('Needs a look')
  })

  it.each(['barista', 'manager', 'owner'] as const)('shows Guide to a %s', (role) => {
    path = '/admin'
    render(<AdminNav ordersToCheck={0} role={role} />)
    expect(screen.getByRole('link', { name: 'Guide' }).getAttribute('href')).toBe('/admin/guide')
  })

  it('marks Guide active on a topic page', () => {
    path = '/admin/guide/troubleshooting'
    render(<AdminNav ordersToCheck={0} role="barista" />)
    expect(screen.getByRole('link', { name: 'Guide' }).getAttribute('aria-current')).toBe('page')
  })
})
