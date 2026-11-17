import { describe, expect, it } from 'vitest'
import { validateImage } from './validate'

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])

function webp() {
  const bytes = new Uint8Array(16)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
  bytes.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
  return bytes
}

function heic() {
  const bytes = new Uint8Array(16)
  bytes.set([0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 4) // ftypheic
  return bytes
}

describe('validateImage', () => {
  it('accepts a JPEG', () => {
    expect(validateImage(jpeg, 1000)).toEqual({
      ok: true,
      contentType: 'image/jpeg',
      extension: 'jpg',
    })
  })

  it('accepts a PNG', () => {
    expect(validateImage(png, 1000).ok).toBe(true)
  })

  it('accepts a WebP', () => {
    expect(validateImage(webp(), 1000).ok).toBe(true)
  })

  it('rejects HEIC with an explanation, not a generic failure', () => {
    const result = validateImage(heic(), 1000)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('HEIC')
  })

  it('rejects a file over 5MB', () => {
    const result = validateImage(jpeg, 5 * 1024 * 1024 + 1)
    expect(result.ok === false && result.error).toContain('5MB')
  })

  it('rejects content whose bytes are not an image at all', () => {
    const result = validateImage(new Uint8Array([0x3c, 0x3f, 0x70, 0x68, 0x70]), 1000)
    expect(result.ok).toBe(false)
  })
})
