import { formatPesos } from '@/lib/money'
import type { DrinkSize, VariantCode } from '@/lib/menu/types'

export const SIZES: DrinkSize[] = ['M', 'L', 'XL', 'HOT']

export function priceRange(prices: { size: string; priceCentavos: number }[]): string {
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

export type CategoryKind = 'drink' | 'food'
export const FOOD_CODES: VariantCode[] = ['REG']

/** Label, temperature and sort order a variant code is saved with. */
export const VARIANT_META: Record<
  VariantCode,
  { label: string; temperature: 'iced' | 'hot' | 'none'; sortOrder: number }
> = {
  M: { label: 'Medium', temperature: 'iced', sortOrder: 0 },
  L: { label: 'Large', temperature: 'iced', sortOrder: 1 },
  XL: { label: 'XL', temperature: 'iced', sortOrder: 2 },
  HOT: { label: 'Hot', temperature: 'hot', sortOrder: 3 },
  REG: { label: 'Regular', temperature: 'none', sortOrder: 0 },
}

export function variantCodesFor(kind: CategoryKind): VariantCode[] {
  return kind === 'food' ? FOOD_CODES : SIZES
}

/** Drinks read price_M/L/XL/HOT; food reads price_REG only. Blank means "not offered". */
export function parseVariantPrices(
  formData: FormData,
  kind: CategoryKind,
): Record<string, number | null> {
  const result: Record<string, number | null> = {}
  for (const code of variantCodesFor(kind)) {
    result[code] = parsePriceInput(String(formData.get(`price_${code}`) ?? ''))
  }
  return result
}

export function menuImageUrl(path: string | null): string | null {
  if (!path) return null
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  return `${base}/storage/v1/object/public/menu-images/${path}`
}
