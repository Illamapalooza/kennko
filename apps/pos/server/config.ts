import fs from 'node:fs'
import path from 'node:path'
import type { Discount } from '@kennko/core'

export type Config = {
  port: number
  /** The secure (https) address tablets install the app from. 0 turns it off. */
  securePort: number
  /** Opens the till in shared PIN mode (pins.ts). "" turns it off. */
  staffPin: string
  /** Asked for voids, cash out, closing the till and menu sync. */
  managerPin: string
  shop: { name: string; address: string; phone: string; receiptFooter: string }
  discounts: Discount[]
  /** Where the till pulls the menu from. Empty means the built-in menu is used. */
  api: { url: string }
  /** A second place for the daily backup, such as a USB stick or a cloud-synced folder. "" keeps one copy only. */
  backupDir: string
}

const DEFAULTS: Config = {
  port: 4466,
  securePort: 4443,
  staffPin: '1234',
  managerPin: '0000',
  shop: {
    name: 'Kennko Coffee',
    address: 'CT. Montalban St., Villa Kananga, Butuan City',
    phone: '0930 599 2729',
    receiptFooter: 'Thank you! See you again soon.',
  },
  discounts: [
    { label: 'Senior / PWD 20%', kind: 'percent', value: 20 },
    { label: 'Promo 10%', kind: 'percent', value: 10 },
  ],
  api: { url: '' },
  backupDir: '',
}

const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback)

export function loadConfig(root: string): Config {
  let raw: Record<string, any> = {}
  const file = path.join(root, 'config.json')
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch (err: any) {
    // A broken file must not quietly fall back to the default PINs.
    if (err.code !== 'ENOENT') throw new Error(`config.json could not be read (${err.message}). Fix it, or delete it to start with the defaults.`)
  }
  const port = Number.isInteger(raw.port) && raw.port > 0 && raw.port < 65536 ? raw.port : DEFAULTS.port
  const discounts = Array.isArray(raw.discounts)
    ? raw.discounts.filter((d: any) => {
      if (!(d && typeof d.label === 'string' && (d.kind === 'percent' || d.kind === 'amount') && Number.isFinite(d.value) && d.value > 0)) return false
      // Sales are recorded in whole percents and whole centavos, so a fractional preset never shows on the till.
      if (Number.isInteger(d.value)) return true
      console.warn(`config.json: the discount "${d.label}" (${d.value}) is not a whole number, so it is left out.`)
      return false
    })
    : DEFAULTS.discounts
  const securePort = raw.securePort === 0 ? 0 : Number.isInteger(raw.securePort) && raw.securePort > 0 && raw.securePort < 65536 && raw.securePort !== port ? raw.securePort : DEFAULTS.securePort
  return {
    port,
    securePort,
    staffPin: str(raw.staffPin, DEFAULTS.staffPin),
    managerPin: str(raw.managerPin, DEFAULTS.managerPin),
    shop: {
      name: str(raw.shop?.name, DEFAULTS.shop.name),
      address: str(raw.shop?.address, DEFAULTS.shop.address),
      phone: str(raw.shop?.phone, DEFAULTS.shop.phone),
      receiptFooter: str(raw.shop?.receiptFooter, DEFAULTS.shop.receiptFooter),
    },
    discounts,
    // An old config.json may still carry a `website` block; it is ignored.
    api: { url: str(raw.api?.url, process.env.KENNKO_API_URL ?? '').trim() },
    backupDir: str(raw.backupDir, DEFAULTS.backupDir).trim(),
  }
}
