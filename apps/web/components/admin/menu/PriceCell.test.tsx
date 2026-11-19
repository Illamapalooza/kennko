import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const updateVariantPrice = vi.fn()
vi.mock('@/app/admin/menu/actions', () => ({
  updateVariantPrice: (...a: unknown[]) => updateVariantPrice(...a),
  setBestseller: vi.fn(),
  setAvailability: vi.fn(),
}))

import { PriceCell } from './PriceCell'

const props = { itemId: 'i1', code: 'M' as const, label: 'M', initialCentavos: 12000, editable: true }

describe('PriceCell', () => {
  beforeEach(() => vi.clearAllMocks())

  it('saves on Enter and shows Saved', async () => {
    updateVariantPrice.mockResolvedValue({ ok: true, priceCentavos: 13000 })
    render(<PriceCell {...props} />)
    const input = screen.getByLabelText('M price')
    fireEvent.change(input, { target: { value: '130' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(updateVariantPrice).toHaveBeenCalledWith('i1', 'M', '130')
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy())
  })

  it('shows the server error', async () => {
    updateVariantPrice.mockResolvedValue({ ok: false, message: 'A price cannot be negative' })
    render(<PriceCell {...props} />)
    const input = screen.getByLabelText('M price')
    fireEvent.change(input, { target: { value: '-1' } })
    fireEvent.blur(input)
    await waitFor(() => expect(screen.getByText('A price cannot be negative')).toBeTruthy())
  })

  it('sends blank as an empty string', async () => {
    updateVariantPrice.mockResolvedValue({ ok: true, priceCentavos: null })
    render(<PriceCell {...props} />)
    const input = screen.getByLabelText('M price')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(updateVariantPrice).toHaveBeenCalledWith('i1', 'M', '')
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy())
  })

  it('does not save when unchanged on blur', () => {
    render(<PriceCell {...props} />)
    fireEvent.blur(screen.getByLabelText('M price'))
    expect(updateVariantPrice).not.toHaveBeenCalled()
  })

  it('is read-only for a barista', () => {
    render(<PriceCell {...props} editable={false} />)
    expect(screen.queryByLabelText('M price')).toBeNull()
    expect(screen.getByText('₱120.00')).toBeTruthy()
  })
})
