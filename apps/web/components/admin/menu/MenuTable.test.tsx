import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/app/admin/menu/actions', () => ({
  updateVariantPrice: vi.fn(),
  setBestseller: vi.fn(),
  setAvailability: vi.fn(),
}))

import { MenuTable } from './MenuTable'
import type { AdminMenu } from '@/lib/menu/types'

const price = (code: 'M' | 'REG') => ({ code, priceCentavos: 10000, isArchived: false, isAvailable: true })
const item = (id: string, name: string, categoryId: string, code: 'M' | 'REG') => ({
  id, name, description: null, imagePath: null, isBestseller: false, isAvailable: true,
  isArchived: false, categoryId, prices: [price(code)], optionGroupIds: [],
})

const menu: AdminMenu = {
  categories: [
    { id: 'c1', name: 'Coffee', kind: 'drink', items: [item('a', 'Latte', 'c1', 'M')] },
    { id: 'c2', name: 'Pastry', kind: 'food', items: [item('b', 'Croissant', 'c2', 'REG')] },
  ],
  optionGroups: [],
}

describe('MenuTable', () => {
  it('shows an empty message for no match', () => {
    render(<MenuTable menu={menu} isOwner />)
    fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'zzz' } })
    expect(screen.getByText('No items match "zzz"')).toBeTruthy()
  })

  it('filters rows by category chip', () => {
    render(<MenuTable menu={menu} isOwner />)
    expect(screen.getByText('Latte')).toBeTruthy()
    expect(screen.getByText('Croissant')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pastry' }))
    expect(screen.queryByText('Latte')).toBeNull()
    expect(screen.getByText('Croissant')).toBeTruthy()
  })

  it('hides + Add from a barista', () => {
    render(<MenuTable menu={menu} isOwner={false} />)
    expect(screen.queryByText('+ Add')).toBeNull()
  })
})
