import fs from 'node:fs'
import path from 'node:path'
import type { Discount } from '@kennko/core'

export type Config = {
  port: number
  /** Asked once per device before the till opens. "" turns it off. */
  staffPin: string
  /** Asked for voids, cash out, closing the till and menu sync. */
  managerPin: string
  shop: { name: string; address: string; phone: string; receiptFooter: string }
  discounts: Discount[]
  /** Read-only access to the website's menu. Empty means the built-in menu is used. */
  website: { url: string; anonKey: string }
  /** A second place for the daily backup, such as a USB stick or a cloud-synced folder. "" keeps one copy only. */
  backupDir: string
}

const DEFAULTS: Config = {
  port: 4466,
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
  website: { url: '', anonKey: '' },
  backupDir: '',
}

const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback)

export function loadConfig(root: string, repoRoot: string): Config {
  // The website's .env.local already holds the Supabase address and public key; reuse it when present.
  try { process.loadEnvFile(path.join(repoRoot, 'apps/web/.env.local')) } catch { /* no env file: built-in menu */ }

  let raw: Record<string, any> = {}
  const file = path.join(root, 'config.json')
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (err: any) {
    if (err.code !== 'ENOENT') console.warn(`Could not read config.json (${err.message}); using defaults.`)
  }
  const port = Number.isInteger(raw.port) && raw.port > 0 && raw.port < 65536 ? raw.port : DEFAULTS.port
  const discounts = Array.isArray(raw.discounts)
    ? raw.discounts.filter((d: any) => d && typeof d.label === 'string' && (d.kind === 'percent' || d.kind === 'amount') && Number.isFinite(d.value) && d.value > 0)
    : DEFAULTS.discounts
  return {
    port,
    staffPin: str(raw.staffPin, DEFAULTS.staffPin),
    managerPin: str(raw.managerPin, DEFAULTS.managerPin),
    shop: {
      name: str(raw.shop?.name, DEFAULTS.shop.name),
      address: str(raw.shop?.address, DEFAULTS.shop.address),
      phone: str(raw.shop?.phone, DEFAULTS.shop.phone),
      receiptFooter: str(raw.shop?.receiptFooter, DEFAULTS.shop.receiptFooter),
    },
    discounts,
    website: {
      url: str(raw.website?.url, process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''),
      anonKey: str(raw.website?.anonKey, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''),
    },
    backupDir: str(raw.backupDir, DEFAULTS.backupDir).trim(),
  }
}
