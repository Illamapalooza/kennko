import { describe, expect, it, vi } from 'vitest'
import { wireFeed } from '../src/app/feed.ts'

describe('wireFeed', () => {
  it('forwards frames and sends the menu once per change', async () => {
    let onFrame!: (json: string) => void
    const publish = vi.fn(async () => {})
    const setMenu = vi.fn(async () => {})
    let menuCall = 0
    const till = {
      followWall: (cb: (json: string) => void) => {
        onFrame = cb
        return () => {}
      },
      wallMenuJson: () => {
        menuCall++
        return JSON.stringify([{ category: 'Coffee', items: [{ name: `Latte ${menuCall}`, star: false }] }])
      },
    }

    wireFeed(till, { publish, setMenu })

    // First frame with menu key "m1"
    onFrame(JSON.stringify({ day: '2026-11-22', orders: [], menuKey: 'm1' }))
    await Promise.resolve()
    expect(publish).toHaveBeenCalledTimes(1)
    expect(setMenu).toHaveBeenCalledTimes(1)

    // Second frame with same menu key "m1" -> setMenu not called again
    onFrame(JSON.stringify({ day: '2026-11-22', orders: [{ id: 1 }], menuKey: 'm1' }))
    await Promise.resolve()
    expect(publish).toHaveBeenCalledTimes(2)
    expect(setMenu).toHaveBeenCalledTimes(1)

    // Third frame with new menu key "m2" -> setMenu called again
    onFrame(JSON.stringify({ day: '2026-11-22', orders: [{ id: 1 }], menuKey: 'm2' }))
    await Promise.resolve()
    expect(publish).toHaveBeenCalledTimes(3)
    expect(setMenu).toHaveBeenCalledTimes(2)
  })
})
