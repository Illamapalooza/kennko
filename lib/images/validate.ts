export type ImageValidation =
  | { ok: true; contentType: string; extension: string }
  | { ok: false; error: string }

const MAX_BYTES = 5 * 1024 * 1024

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, i) => bytes[offset + i] === byte)
}

export function validateImage(bytes: Uint8Array, sizeBytes: number): ImageValidation {
  if (sizeBytes > MAX_BYTES) {
    return { ok: false, error: 'That image is larger than 5MB. Try a smaller photo.' }
  }

  // Checked before the accept list so iPhone users get a real explanation.
  const heicBrands = ['heic', 'heix', 'hevc', 'mif1']
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...bytes.slice(8, 12))
    if (heicBrands.includes(brand)) {
      return {
        ok: false,
        error:
          'That is a HEIC photo, which browsers cannot display. On iPhone, set ' +
          'Camera > Formats to "Most Compatible", or export it as JPEG first.',
      }
    }
  }

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { ok: true, contentType: 'image/jpeg', extension: 'jpg' }
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ok: true, contentType: 'image/png', extension: 'png' }
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return { ok: true, contentType: 'image/webp', extension: 'webp' }
  }

  return { ok: false, error: 'That file is not a JPEG, PNG, or WebP image.' }
}
