import { describe, expect, it } from 'vitest'
import { qrSvg } from './qr'

describe('qrSvg', () => {
  it('makes an svg with no script', async () => {
    const svg = await qrSvg('KC-7F3-K9Q-XAM')
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.toLowerCase()).not.toContain('<script')
  })
})
