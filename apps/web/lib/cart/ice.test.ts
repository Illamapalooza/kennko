import { describe, expect, it } from 'vitest'
import { takesIce, takesIceServe, normaliseIce, iceSummary } from './ice'

describe('takesIce', () => {
  it('is false for a hot drink', () => {
    expect(takesIce('HOT')).toBe(false)
  })
  it('is true for every cold size', () => {
    expect(takesIce('M')).toBe(true)
    expect(takesIce('L')).toBe(true)
    expect(takesIce('XL')).toBe(true)
  })
})

describe('takesIceServe', () => {
  it('is false when there is no ice to serve', () => {
    expect(takesIceServe('M', 'none')).toBe(false)
  })
  it('is true when ice is present', () => {
    expect(takesIceServe('M', 'regular')).toBe(true)
    expect(takesIceServe('M', 'less')).toBe(true)
  })
  it('is false for a hot drink regardless of level', () => {
    expect(takesIceServe('HOT', 'regular')).toBe(false)
  })
})

describe('normaliseIce', () => {
  it('strips ice from a hot drink', () => {
    expect(normaliseIce('HOT', 'regular', 'mixed')).toEqual({ level: null, serve: null })
  })

  it('defaults a cold drink to regular ice, mixed in', () => {
    expect(normaliseIce('L', null, null)).toEqual({ level: 'regular', serve: 'mixed' })
  })

  it('drops the serve choice when no ice is asked for', () => {
    expect(normaliseIce('L', 'none', 'side')).toEqual({ level: 'none', serve: null })
  })

  it('keeps an explicit side choice', () => {
    expect(normaliseIce('L', 'less', 'side')).toEqual({ level: 'less', serve: 'side' })
  })

  it('never leaves a stale instruction when switching cold to hot', () => {
    const cold = normaliseIce('M', 'less', 'side')
    expect(normaliseIce('HOT', cold.level, cold.serve)).toEqual({ level: null, serve: null })
  })
})

describe('iceSummary', () => {
  it('says nothing for a hot drink', () => {
    expect(iceSummary(null, null)).toBeNull()
  })
  it('reads the way a barista would write it on a cup', () => {
    expect(iceSummary('none', null)).toBe('No ice')
    expect(iceSummary('less', 'mixed')).toBe('Less ice')
    expect(iceSummary('less', 'side')).toBe('Less ice, on the side')
    expect(iceSummary('regular', 'side')).toBe('Regular ice, on the side')
  })
})
