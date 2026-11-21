import { describe, expect, it, vi } from 'vitest'
import { appBackup, wireLifecycle } from '../src/app/lifecycle.ts'

describe('lifecycle & appBackup', () => {
  it('pause pauses the till', () => {
    const listeners: Record<string, () => void> = {}
    const till = { pause: vi.fn(), resume: vi.fn() }
    wireLifecycle(till, { addListener: (e, fn) => { listeners[e] = fn } })
    listeners.pause()
    expect(till.pause).toHaveBeenCalledTimes(1)
    expect(till.resume).not.toHaveBeenCalled()
  })

  it('resume resumes the till once per resume', () => {
    const listeners: Record<string, () => void> = {}
    const till = { pause: vi.fn(), resume: vi.fn() }
    wireLifecycle(till, { addListener: (e, fn) => { listeners[e] = fn } })
    listeners.resume()
    listeners.resume()
    expect(till.resume).toHaveBeenCalledTimes(2)
  })

  it('appBackup returns an error line instead of throwing', () => {
    const line = appBackup(
      () => { throw new Error('disk full') },
      Date.UTC(2026, 10, 21, 16, 30),
      (day) => `/tmp/pos-${day}.db`,
    )
    expect(line).toContain('disk full')
  })

  it('appBackup names the file by Manila day', () => {
    let seenPath = ''
    const line = appBackup(
      (file) => { seenPath = file },
      Date.UTC(2026, 10, 21, 16, 30), // 00:30 on 2026-11-22 in Manila (UTC+8)
      (day) => `/data/backups/pos-${day}.db`,
    )
    expect(seenPath).toBe('/data/backups/pos-2026-11-22.db')
    expect(line).toContain('pos-2026-11-22.db')
  })
})
