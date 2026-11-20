import { describe, expect, it } from 'vitest'
import { flagText, reasonText } from './text'

describe('reasonText', () => {
  it('maps the held reasons', () => {
    expect(reasonText('held', 'another_shift_open')).toBe('Waiting: this till still has an open shift on Kennko')
    expect(reasonText('held', 'shift_unknown')).toBe('Waiting for its shift to arrive')
    expect(reasonText('held', 'order_unknown')).toBe('Waiting for its sale to arrive')
    expect(reasonText('held', 'waits_for_earlier')).toBe('Waiting behind another problem on the same sale or shift')
  })
  it('maps the prefix forms, legacy first', () => {
    expect(reasonText('held', 'invalid: legacy: bad total')).toBe('Old record that could not be stored: bad total')
    expect(reasonText('held', 'invalid: bad total')).toBe("Can't be stored as sent: bad total")
    expect(reasonText('held', 'error: timeout')).toBe('Failed, will try again: timeout')
  })
  it('maps every flagged receipt reason, one line each', () => {
    const reasons = ['already_recorded_differs', 'not_for_counter', 'online_order', 'not_paid', 'not_from_till', 'unknown_item']
    const lines = reasons.map((r) => reasonText('flagged', r))
    expect(lines[0]).toBe('Sent again with different totals')
    for (const [i, line] of lines.entries()) expect(line, reasons[i]).not.toBe(reasons[i])
    expect(new Set(lines).size).toBe(reasons.length)
  })
  it('joins several flagged reasons', () => {
    expect(reasonText('flagged', 'not_paid,online_order')).toBe(`${reasonText('flagged', 'not_paid')}; ${reasonText('flagged', 'online_order')}`)
  })
  it('passes an unknown reason through, and says nothing for none', () => {
    expect(reasonText('held', 'something_new')).toBe('something_new')
    expect(reasonText('discarded', null)).toBe('')
  })
})

describe('flagText', () => {
  it('maps the order flags', () => {
    for (const f of ['reprice_mismatch', 'unknown_version', 'ticket_duplicate', 'clock_skew']) {
      expect(flagText(f), f).not.toBe(f)
    }
  })
  it('passes an unknown flag through', () => expect(flagText('odd')).toBe('odd'))
})
