import type { AdminMenu, AdminTableItem, VariantCode } from '@/lib/menu/types'
import { variantCodesFor } from './format'

export type MenuFilterOptions = {
  query: string
  categoryId: string | null
  showArchived: boolean
  soldOutOnly: boolean
}

export type RowCell = { code: VariantCode; label: string; priceCentavos: number | null }

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function filterMenu(menu: AdminMenu, opts: MenuFilterOptions): AdminMenu {
  const query = fold(opts.query.trim())
  const categories = menu.categories
    .filter((c) => opts.categoryId === null || c.id === opts.categoryId)
    .map((c) => ({
      ...c,
      items: c.items.filter(
        (i) =>
          (opts.showArchived || !i.isArchived) &&
          (!opts.soldOutOnly || !i.isAvailable) &&
          (query === '' || fold(i.name).includes(query)),
      ),
    }))
    .filter((c) => c.items.length > 0)
  return { ...menu, categories }
}

export function rowCells(item: AdminTableItem, kind: 'drink' | 'food'): RowCell[] {
  return variantCodesFor(kind).map((code) => {
    const price = item.prices.find((p) => p.code === code && !p.isArchived)
    return {
      code,
      label: kind === 'food' ? 'Single price' : code,
      priceCentavos: price ? price.priceCentavos : null,
    }
  })
}
