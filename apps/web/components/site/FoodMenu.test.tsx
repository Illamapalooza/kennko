import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { FoodMenu } from './FoodMenu'

describe('FoodMenu', () => {
  it('lists each food item with its options and a formatted price', () => {
    render(<FoodMenu />)

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
    render(<FoodMenu />)
    expect(screen.queryByText(/empanda/i)).toBeNull()
  })

  it('hides the decorative mascot stickers from screen readers', () => {
    const { container } = render(<FoodMenu />)
    const stickers = container.querySelectorAll('img.food-sticker')
    expect(stickers.length).toBeGreaterThan(0)
    stickers.forEach((img) => expect(img.getAttribute('alt')).toBe(''))
  })
})
