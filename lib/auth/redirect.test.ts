import { describe, expect, it } from 'vitest'
import { safeNextPath } from './redirect'

describe('safeNextPath', () => {
  it('keeps a same-origin path', () => {
    expect(safeNextPath('/orders')).toBe('/orders')
    expect(safeNextPath('/order/KNK-7F3Q')).toBe('/order/KNK-7F3Q')
  })

  it('falls back when nothing was requested', () => {
    expect(safeNextPath(null)).toBe('/orders')
    expect(safeNextPath('')).toBe('/orders')
  })

  it('refuses an absolute URL to another site', () => {
    expect(safeNextPath('https://evil.example.com')).toBe('/orders')
    expect(safeNextPath('http://evil.example.com/path')).toBe('/orders')
  })

  it('refuses a protocol-relative URL', () => {
    expect(safeNextPath('//evil.example.com')).toBe('/orders')
  })

  it('refuses backslash tricks some browsers treat as a host', () => {
    expect(safeNextPath('/\\evil.example.com')).toBe('/orders')
    expect(safeNextPath('\\\\evil.example.com')).toBe('/orders')
  })

  it('refuses an embedded scheme', () => {
    expect(safeNextPath('/redirect?to=javascript://alert(1)')).toBe('/orders')
  })

  it('honours a caller-supplied fallback', () => {
    expect(safeNextPath('https://evil.example.com', '/order')).toBe('/order')
  })
})
