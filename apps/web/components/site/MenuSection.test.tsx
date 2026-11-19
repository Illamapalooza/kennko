import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MenuSection } from './MenuSection'
import type { MenuCategoryWithItems } from '@/lib/menu/types'

const categories: MenuCategoryWithItems[] = [
  {
    id: 'cat-1',
    name: 'Premium Classics',
    items: [
      {
        id: 'item-1',
        name: 'Americano',
        description: null,
        imagePath: null,
        isBestseller: false,
        isAvailable: true,
        optionGroupIds: [],
        prices: [
          { size: 'M', priceCentavos: 8000 },
          { size: 'L', priceCentavos: 9000 },
        ],
      },
      {
        id: 'item-2',
        name: 'Spanish Latte',
        description: null,
        imagePath: null,
        isBestseller: true,
        isAvailable: true,
        optionGroupIds: [],
        prices: [{ size: 'M', priceCentavos: 10500 }],
      },
      {
        id: 'item-3',
        name: 'Hazelnut Latte',
        description: null,
        imagePath: null,
        isBestseller: false,
        isAvailable: false,
        optionGroupIds: [],
        prices: [{ size: 'M', priceCentavos: 10500 }],
      },
    ],
  },
]

describe('MenuSection', () => {
  it('renders each category as a card', () => {
    render(<MenuSection categories={categories} />)
    expect(screen.getByRole('heading', { name: 'Premium Classics' })).toBeDefined()
  })

  it('shows the cheapest size as the starting price', () => {
    render(<MenuSection categories={categories} />)
    const americano = screen.getByText('Americano').closest('li')!
    expect(within(americano).getByText('₱80')).toBeDefined()
  })

  it('stars bestsellers, and marks the star up so it can be coloured', () => {
    render(<MenuSection categories={categories} />)
    const row = screen.getByText('Spanish Latte').closest('li')!
    const star = row.querySelector('.star')
    expect(star).not.toBeNull()
    expect(star!.textContent).toContain('★')
  })

  it('does not star a non-bestseller', () => {
    render(<MenuSection categories={categories} />)
    const row = screen.getByText('Americano').closest('li')!
    expect(row.querySelector('.star')).toBeNull()
  })

  it('greys out unavailable items instead of hiding them', () => {
    render(<MenuSection categories={categories} />)
    const hazelnut = screen.getByText('Hazelnut Latte').closest('li')!
    expect(hazelnut.className).toContain('is-unavailable')
    expect(within(hazelnut).getByText('Sold out')).toBeDefined()
  })

  it('renders nothing but the heading when the menu is empty', () => {
    render(<MenuSection categories={[]} />)
    expect(screen.getByRole('heading', { name: 'Menu highlights' })).toBeDefined()
    expect(screen.queryByRole('article')).toBeNull()
  })
})
