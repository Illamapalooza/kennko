import QRCode from 'qrcode'

/** A QR code as an inline SVG string (a white quiet zone of 4 modules is part of it). Nothing here is scriptable. */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    margin: 4,
    errorCorrectionLevel: 'M',
    color: { dark: '#0d1b3d', light: '#ffffff' },
  })
}
