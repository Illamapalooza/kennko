import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const closeShift = vi.fn(async () => ({ ok: true as const }))
vi.mock('@/app/admin/attention/actions', () => ({ closeShift: (...a: unknown[]) => closeShift(...(a as [])) }))

import { CloseShiftForm } from './CloseShiftForm'

function fill(counted: string) {
  render(<CloseShiftForm shiftId="s1" tillName="Till 1" />)
  fireEvent.click(screen.getByRole('button', { name: 'Close this shift' }))
  fireEvent.change(screen.getByLabelText(/Cash counted/), { target: { value: counted } })
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'left' } })
  fireEvent.click(screen.getByRole('button', { name: 'Close shift' }))
}

describe('CloseShiftForm', () => {
  it('refuses a bad amount before the confirm step', () => {
    fill('abc')
    expect(screen.getByRole('alert').textContent).toBe('Enter the counted cash in pesos.')
    expect(screen.queryByText(/Yes, close it/)).toBeNull()
  })
  it('confirms with the amount formatted once', () => {
    fill('₱20')
    const text = document.querySelector('.admin-notice')!.textContent!
    expect(text).toContain('with ₱20 counted')
    expect(text).not.toContain('₱₱')
    expect(screen.getByRole('button', { name: 'Yes, close it' })).toBeTruthy()
  })
})
