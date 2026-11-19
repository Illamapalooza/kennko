import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const updateVariantPrice = vi.fn()
vi.mock('@/app/admin/menu/actions', () => ({
  updateVariantPrice: (...a: unknown[]) => updateVariantPrice(...a),
  setBestseller: vi.fn(),
  setAvailability: vi.fn(),
}))

import { PriceCell } from './PriceCell'
import { hasDirty } from '@/lib/admin/dirty'

const props = { itemId: 'i1', itemName: 'Americano', code: 'M' as const, label: 'M', initialCentavos: 12000, editable: true }

describe('PriceCell', () => {
  beforeEach(() => vi.clearAllMocks())

  it('saves on Enter and shows Saved', async () => {
    updateVariantPrice.mockResolvedValue({ ok: true, priceCentavos: 13000 })
    render(<PriceCell {...props} />)
    const input = screen.getByLabelText('Americano M price')
    fireEvent.change(input, { target: { value: '130' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(updateVariantPrice).toHaveBeenCalledWith('i1', 'M', '130')
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy())
  })

  it('shows the server error', async () => {
    updateVariantPrice.mockResolvedValue({ ok: false, message: 'A price cannot be negative' })
    render(<PriceCell {...props} />)
    const input = screen.getByLabelText('Americano M price')
    fireEvent.change(input, { target: { value: '-1' } })
    fireEvent.blur(input)
    await waitFor(() => expect(screen.getByText('A price cannot be negative')).toBeTruthy())
  })

  it('sends blank as an empty string', async () => {
    updateVariantPrice.mockResolvedValue({ ok: true, priceCentavos: null })
    render(<PriceCell {...props} />)
    const input = screen.getByLabelText('Americano M price')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(updateVariantPrice).toHaveBeenCalledWith('i1', 'M', '')
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy())
  })

  it('does not save when unchanged on blur', () => {
    render(<PriceCell {...props} />)
    fireEvent.blur(screen.getByLabelText('Americano M price'))
    expect(updateVariantPrice).not.toHaveBeenCalled()
  })

  it('is read-only for a barista', () => {
    render(<PriceCell {...props} editable={false} />)
    expect(screen.queryByLabelText('Americano M price')).toBeNull()
    expect(screen.getByText('₱120')).toBeTruthy()
  })

  it('keeps newer typed text and sends it after the first save resolves', async () => {
    let resolveFirst: (v: unknown) => void = () => {}
    updateVariantPrice
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
      .mockResolvedValueOnce({ ok: true, priceCentavos: 12000 })
    render(<PriceCell {...props} />)
    const input = screen.getByLabelText('Americano M price') as HTMLInputElement
    fireEvent.change(input, { target: { value: '100' } })
    fireEvent.blur(input)
    fireEvent.change(input, { target: { value: '120' } })
    fireEvent.blur(input)
    resolveFirst({ ok: true, priceCentavos: 10000 })
    await waitFor(() => expect(updateVariantPrice).toHaveBeenCalledTimes(2))
    expect(updateVariantPrice).toHaveBeenLastCalledWith('i1', 'M', '120')
    expect(Number(input.value)).toBe(120)
  })

  it('recovers when the action throws', async () => {
    updateVariantPrice.mockRejectedValue(new Error('network'))
    render(<PriceCell {...props} />)
    const input = screen.getByLabelText('Americano M price') as HTMLInputElement
    fireEvent.change(input, { target: { value: '130' } })
    fireEvent.blur(input)
    await waitFor(() => expect(screen.getByText('Could not save. Try again.')).toBeTruthy())
    expect(screen.queryByText('Saving…')).toBeNull()
    expect(input.value).toBe('130')
  })

  it('shows a refreshed price when idle and not dirty', () => {
    const { rerender } = render(<PriceCell {...props} />)
    rerender(<PriceCell {...props} initialCentavos={15000} />)
    expect((screen.getByLabelText('Americano M price') as HTMLInputElement).value).toBe('150.00')
  })

  it('keeps unsaved text when a refresh brings a new price', () => {
    const { rerender } = render(<PriceCell {...props} />)
    const input = screen.getByLabelText('Americano M price') as HTMLInputElement
    fireEvent.change(input, { target: { value: '99' } })
    rerender(<PriceCell {...props} initialCentavos={15000} />)
    expect(input.value).toBe('99')
  })

  it('marks itself dirty while text is unsaved or a save is in flight', async () => {
    let resolveSave: (v: unknown) => void = () => {}
    updateVariantPrice.mockImplementationOnce(() => new Promise((r) => { resolveSave = r }))
    const { unmount } = render(<PriceCell {...props} />)
    expect(hasDirty()).toBe(false)
    const input = screen.getByLabelText('Americano M price')
    fireEvent.change(input, { target: { value: '130' } })
    expect(hasDirty()).toBe(true)
    fireEvent.blur(input)
    expect(hasDirty()).toBe(true)
    resolveSave({ ok: true, priceCentavos: 13000 })
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy())
    expect(hasDirty()).toBe(false)
    fireEvent.change(input, { target: { value: '140' } })
    expect(hasDirty()).toBe(true)
    unmount()
    expect(hasDirty()).toBe(false)
  })
})
