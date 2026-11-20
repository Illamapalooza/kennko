import { StrictMode } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { OrderClient } from './OrderClient'

const props = { categories: [], modifierGroups: [], zones: [], customer: null }

afterEach(() => {
  cleanup()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('OrderClient empty-cart guard', () => {
  it.each(['pay', 'checkout'])(
    'shows the notice for ?step=%s with an empty cart, even under StrictMode',
    async (step) => {
      window.history.replaceState(null, '', `/order?step=${step}`)
      render(
        <StrictMode>
          <OrderClient {...props} />
        </StrictMode>,
      )
      await waitFor(() =>
        expect(screen.getByRole('status').textContent).toBe('Your cart is empty — pick something first.'),
      )
      expect(window.location.search).toBe('')
    },
  )

  it('shows no notice on a plain /order', async () => {
    window.history.replaceState(null, '', '/order')
    render(<StrictMode><OrderClient {...props} /></StrictMode>)
    await waitFor(() => expect(screen.getByText('The Kennko catalog')).toBeTruthy())
    expect(screen.queryByRole('status')).toBeNull()
  })
})
