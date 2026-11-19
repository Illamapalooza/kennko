import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const setAvailability = vi.fn()
const setBestseller = vi.fn()
vi.mock('@/app/admin/menu/actions', () => ({
  setAvailability: (...a: unknown[]) => setAvailability(...a),
  setBestseller: (...a: unknown[]) => setBestseller(...a),
}))

import { AvailabilityToggle } from './AvailabilityToggle'
import { StarToggle } from './menu/StarToggle'

beforeEach(() => vi.clearAllMocks())

describe('AvailabilityToggle', () => {
  it('shows the server message inline on failure', async () => {
    setAvailability.mockResolvedValue({ ok: false, message: 'Could not update availability: boom' })
    render(<AvailabilityToggle itemId="i1" isAvailable />)
    fireEvent.click(screen.getByRole('button', { name: 'Mark sold out' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not update availability: boom')
    expect(setAvailability).toHaveBeenCalledWith('i1', false)
  })

  it('shows a fallback message when the action throws', async () => {
    setAvailability.mockRejectedValue(new Error('network'))
    render(<AvailabilityToggle itemId="i1" isAvailable />)
    fireEvent.click(screen.getByRole('button', { name: 'Mark sold out' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save. Try again.')
  })

  it('shows no alert on success', async () => {
    setAvailability.mockResolvedValue({ ok: true })
    render(<AvailabilityToggle itemId="i1" isAvailable />)
    fireEvent.click(screen.getByRole('button', { name: 'Mark sold out' }))
    await screen.findByRole('button', { name: 'Mark sold out' })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('StarToggle', () => {
  it('reverts and shows the server message on failure', async () => {
    setBestseller.mockResolvedValue({ ok: false, message: 'Only the owner can change bestsellers.' })
    render(<StarToggle itemId="i1" isBestseller={false} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Mark as bestseller' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Only the owner can change bestsellers.')
    expect(screen.getByRole('button', { name: 'Mark as bestseller' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('reverts and shows a fallback message when the action throws', async () => {
    setBestseller.mockRejectedValue(new Error('network'))
    render(<StarToggle itemId="i1" isBestseller={false} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Mark as bestseller' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save. Try again.')
    expect(screen.getByRole('button', { name: 'Mark as bestseller' }).getAttribute('aria-pressed')).toBe('false')
  })
})
