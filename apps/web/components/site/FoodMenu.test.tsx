import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { FoodMenu } from './FoodMenu'
import type { FoodItem } from '@/lib/menu/queries'

const items: FoodItem[] = [
  { id: '1', name: 'Cookies', options: ['Original', 'Chocolate', 'Red Velvet'], priceCentavos: 6000, isAvailable: true },
  { id: '2', name: 'Empanada', options: ['Chicken'], priceCentavos: 4500, isAvailable: true },
  { id: '3', name: 'Fries', options: ['Original', 'Cheese', 'BBQ', 'Sour Cream'], priceCentavos: 8500, isAvailable: true },
]

describe('FoodMenu', () => {
  it('shows nothing for an empty list without crashing', () => {
    render(<FoodMenu items={[]} />)
    expect(screen.queryAllByRole('article')).toHaveLength(0)
  })

  it('renders the items it is given, each with its options and a formatted price', () => {
    render(<FoodMenu items={items} />)

    const cookies = screen.getByRole('article', { name: 'Cookies' })
    expect(within(cookies).getByText('Red Velvet')).toBeTruthy()
    expect(within(cookies).getByText('₱60')).toBeTruthy()

    const empanada = screen.getByRole('article', { name: 'Empanada' })
    expect(within(empanada).getByText('Chicken')).toBeTruthy()
    expect(within(empanada).getByText('₱45')).toBeTruthy()

    const fries = screen.getByRole('article', { name: 'Fries' })
    expect(within(fries).getByText('Sour Cream')).toBeTruthy()
    expect(within(fries).getByText('₱85')).toBeTruthy()
  })

  it('spells empanada correctly, unlike the source flyer', () => {
    render(<FoodMenu items={items} />)
    expect(screen.queryByText(/empanda/i)).toBeNull()
  })

  it('hides the decorative mascot stickers from screen readers', () => {
    const { container } = render(<FoodMenu items={items} />)
    const stickers = container.querySelectorAll('img.food-sticker')
    expect(stickers.length).toBeGreaterThan(0)
    stickers.forEach((img) => expect(img.getAttribute('alt')).toBe(''))
  })
})
