import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'


const { default: OrderError } = await import('./[code]/error')
const { default: OrdersError } = await import('../orders/error')

afterEach(cleanup)

describe.each([
  ['order page', OrderError],
  ['order history', OrdersError],
])('%s error boundary', (_name, Page) => {
  it('says the order is safe, retries, and links back to /order', () => {
    const reset = vi.fn()
    render(<Page error={new Error('Could not load order (503)')} reset={reset} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain("We couldn't load your order")
    expect(alert.textContent).toContain('Your order is safe')
    expect(alert.textContent).not.toContain('503')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reset).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link').getAttribute('href')).toBe('/order')
  })
})
