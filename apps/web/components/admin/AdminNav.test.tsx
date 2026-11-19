import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let path = '/admin'
vi.mock('next/navigation', () => ({ usePathname: () => path }))

import { AdminNav } from './AdminNav'

describe('AdminNav', () => {
  it('marks the active link', () => {
    path = '/admin/menu/new'
    render(<AdminNav ordersToCheck={0} isOwner />)
    expect(screen.getByRole('link', { name: 'Menu' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBeNull()
  })

  it('only marks Overview on exactly /admin', () => {
    path = '/admin'
    render(<AdminNav ordersToCheck={0} isOwner />)
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page')
  })

  it('hides Staff from a barista', () => {
    path = '/admin'
    render(<AdminNav ordersToCheck={0} isOwner={false} />)
    expect(screen.queryByRole('link', { name: 'Staff' })).toBeNull()
  })

  it('shows Staff to an owner', () => {
    path = '/admin'
    render(<AdminNav ordersToCheck={0} isOwner />)
    expect(screen.getByRole('link', { name: 'Staff' }).getAttribute('href')).toBe('/admin/staff')
  })

  it('shows a badge with the count of orders waiting', () => {
    path = '/admin'
    render(<AdminNav ordersToCheck={2} isOwner />)
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('shows no badge at zero', () => {
    path = '/admin'
    render(<AdminNav ordersToCheck={0} isOwner />)
    expect(screen.queryByText('0')).toBeNull()
  })
})
