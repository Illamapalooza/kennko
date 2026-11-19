'use client'

import { useState } from 'react'
import { variantCodesFor, type CategoryKind } from '@/app/admin/menu/format'

type Category = { id: string; name: string; kind: CategoryKind }

/** The category picker and the price inputs that depend on it: sizes for drinks, one price for food. */
export function CategoryPriceFields({
  categories,
  categoryId,
  prices,
}: {
  categories: Category[]
  categoryId: string
  prices: { size: string; priceCentavos: number }[]
}) {
  const [selected, setSelected] = useState(categoryId)
  const kind = categories.find((c) => c.id === selected)?.kind ?? 'drink'
  const priceFor = (code: string) => {
    const match = prices.find((p) => p.size === code)
    return match ? (match.priceCentavos / 100).toString() : ''
  }

  return (
    <>
      <label className="admin-field">
        <span>Category</span>
        <select
          name="category_id"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          required
        >
          <option value="">Choose…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {kind === 'food' ? (
        <fieldset key="food">
          <legend>Price in pesos</legend>
          <label className="admin-field">
            <span>Price</span>
            <input name="price_REG" inputMode="decimal" defaultValue={priceFor('REG')} required />
          </label>
        </fieldset>
      ) : (
        <fieldset key="drink">
          <legend>Prices in pesos — leave blank for sizes you do not offer</legend>
          {variantCodesFor('drink').map((code) => (
            <label className="admin-field" key={code}>
              <span>{code}</span>
              <input
                name={`price_${code}`}
                inputMode="decimal"
                defaultValue={priceFor(code)}
                placeholder="—"
              />
            </label>
          ))}
        </fieldset>
      )}
    </>
  )
}
