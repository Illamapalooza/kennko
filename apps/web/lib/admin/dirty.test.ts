import { beforeEach, describe, expect, it } from 'vitest'
import { clearDirty, hasDirty, markDirty, shouldRefresh } from './dirty'

describe('dirty guard', () => {
  beforeEach(() => {
    clearDirty('a')
    clearDirty('b')
  })

  it('is clean until something is marked', () => {
    expect(hasDirty()).toBe(false)
    markDirty('a')
    expect(hasDirty()).toBe(true)
  })

  it('stays dirty until every id is cleared', () => {
    markDirty('a')
    markDirty('b')
    clearDirty('a')
    expect(hasDirty()).toBe(true)
    clearDirty('b')
    expect(hasDirty()).toBe(false)
  })

  it('marking the same id twice needs one clear', () => {
    markDirty('a')
    markDirty('a')
    clearDirty('a')
    expect(hasDirty()).toBe(false)
  })
})

describe('shouldRefresh', () => {
  it('refreshes only when visible and nothing is dirty', () => {
    expect(shouldRefresh(true, false)).toBe(true)
    expect(shouldRefresh(false, false)).toBe(false)
    expect(shouldRefresh(true, true)).toBe(false)
    expect(shouldRefresh(false, true)).toBe(false)
  })
})
