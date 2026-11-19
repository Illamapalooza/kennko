import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { AutoRefresh } from './AutoRefresh'
import { clearDirty, markDirty } from '@/lib/admin/dirty'

let visibility: DocumentVisibilityState = 'visible'

function setVisibility(v: DocumentVisibilityState) {
  visibility = v
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('AutoRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    refresh.mockClear()
    visibility = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  })
  afterEach(() => {
    clearDirty('cell')
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('refreshes every 45 seconds while visible', () => {
    render(<AutoRefresh />)
    vi.advanceTimersByTime(44_999)
    expect(refresh).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(45_000)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('skips while hidden and refreshes as soon as the page is visible again', () => {
    render(<AutoRefresh />)
    setVisibility('hidden')
    vi.advanceTimersByTime(45_000)
    expect(refresh).not.toHaveBeenCalled()
    setVisibility('visible')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('skips while a price cell is dirty', () => {
    render(<AutoRefresh />)
    markDirty('cell')
    vi.advanceTimersByTime(45_000)
    setVisibility('visible')
    expect(refresh).not.toHaveBeenCalled()
    clearDirty('cell')
    vi.advanceTimersByTime(45_000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('stops on unmount', () => {
    const { unmount } = render(<AutoRefresh />)
    unmount()
    vi.advanceTimersByTime(90_000)
    setVisibility('visible')
    expect(refresh).not.toHaveBeenCalled()
  })
})
