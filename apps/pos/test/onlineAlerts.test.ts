import { describe, expect, it } from 'vitest'
import { bannerText, nextOnlineAlerts } from '../src/onlineAlerts.ts'

describe('onlineAlerts', () => {
  it('first load is the baseline', () => {
    const res = nextOnlineAlerts(null, [{ id: 'id1', label: 'W1' }, { id: 'id2', label: 'W2' }])
    expect(res.fresh).toEqual([])
    expect(res.memory.seen).toEqual(['id1', 'id2'])
  })

  it('a new order is fresh once', () => {
    const first = nextOnlineAlerts({ seen: ['id1'] }, [{ id: 'id1', label: 'W1' }, { id: 'id3', label: 'W3' }])
    expect(first.fresh).toEqual(['W3'])
    const second = nextOnlineAlerts(first.memory, [{ id: 'id1', label: 'W1' }, { id: 'id3', label: 'W3' }])
    expect(second.fresh).toEqual([])
  })

  it('seen is capped at 200, keeping the newest', () => {
    const existing = Array.from({ length: 195 }, (_, i) => `old-${i}`)
    const incoming = Array.from({ length: 10 }, (_, i) => ({ id: `new-${i}`, label: `W${i + 1}` }))
    const res = nextOnlineAlerts({ seen: existing }, incoming)
    expect(res.memory.seen).toHaveLength(200)
    expect(res.memory.seen[0]).toBe('old-5')
    expect(res.memory.seen[199]).toBe('new-9')
  })

  it('formats bannerText for 1 or many orders', () => {
    expect(bannerText(['W3'])).toBe('New online order W3')
    expect(bannerText(['W3', 'W4', 'W5'])).toBe('3 new online orders')
  })
})
