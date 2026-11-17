import { formatPesos } from '@/lib/money'
import type { DrinkSize, MenuItemPrice } from '@/lib/menu/types'

export const SIZES: DrinkSize[] = ['M', 'L', 'XL', 'HOT']

export function priceRange(prices: MenuItemPrice[]): string {
  if (prices.length === 0) return 'No price set'
  const values = prices.map((p) => p.priceCentavos)
  const low = Math.min(...values)
  const high = Math.max(...values)
  return low === high ? formatPesos(low) : `${formatPesos(low)} – ${formatPesos(high)}`
}

export function parsePriceInput(raw: string): number | null {
  const cleaned = raw.replace(/[₱,\s]/g, '')
  if (cleaned === '') return null

  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`"${raw.trim()}" is not a valid price`)
  }
  if (cleaned.startsWith('-')) {
    throw new Error('A price cannot be negative')
  }

  const [pesos, decimals = ''] = cleaned.split('.')
  if (decimals.length > 2) {
    throw new Error('A price cannot have more than two decimal places')
  }

  // String maths, not float maths: 10.555 * 100 is 1055.4999... in IEEE 754.
  return Number(pesos) * 100 + Number(decimals.padEnd(2, '0'))
}

export function parseSizePrices(formData: FormData): Record<DrinkSize, number | null> {
  const result = {} as Record<DrinkSize, number | null>
  for (const size of SIZES) {
    result[size] = parsePriceInput(String(formData.get(`price_${size}`) ?? ''))
  }
  return result
}

export function menuImageUrl(path: string | null): string | null {
  if (!path) return null
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  return `${base}/storage/v1/object/public/menu-images/${path}`
}
