import { saveMenuItem } from '@/app/admin/menu/actions'
import { SIZES } from '@/app/admin/menu/format'
import { ImageUploadField } from './ImageUploadField'
import type { DrinkSize, MenuItemWithPrices } from '@/lib/menu/types'

type EditableItem = MenuItemWithPrices & { categoryId: string; imageUrl: string | null }

export function MenuItemForm({
  item,
  categories,
}: {
  item?: EditableItem
  categories: { id: string; name: string }[]
}) {
  const priceFor = (size: DrinkSize) => {
    const match = item?.prices.find((p) => p.size === size)
    return match ? (match.priceCentavos / 100).toString() : ''
  }

  return (
    <>
      <form action={saveMenuItem}>
        {item ? <input type="hidden" name="id" value={item.id} /> : null}

        <label className="admin-field">
          <span>Name</span>
          <input name="name" defaultValue={item?.name ?? ''} required />
        </label>

        <label className="admin-field">
          <span>Category</span>
          <select name="category_id" defaultValue={item?.categoryId ?? ''} required>
            <option value="">Choose…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="admin-field">
          <span>Description (optional)</span>
          <textarea name="description" defaultValue={item?.description ?? ''} />
        </label>

        <fieldset>
          <legend>Prices in pesos — leave blank for sizes you do not offer</legend>
          {SIZES.map((size) => (
            <label className="admin-field" key={size}>
              <span>{size}</span>
              <input
                name={`price_${size}`}
                inputMode="decimal"
                defaultValue={priceFor(size)}
                placeholder="—"
              />
            </label>
          ))}
        </fieldset>

        <label className="admin-field">
          <span>
            <input
              type="checkbox"
              name="is_bestseller"
              defaultChecked={item?.isBestseller ?? false}
              style={{ width: 'auto', minHeight: 'auto', marginRight: '8px' }}
            />
            Bestseller (shows a ★)
          </span>
        </label>

        <p className="admin-notice">
          Price changes apply to future orders only. Orders already placed keep the
          price they were charged.
        </p>

        <button className="btn btn-primary" type="submit">
          Save drink
        </button>
      </form>

      {item ? (
        <ImageUploadField itemId={item.id} currentUrl={item.imageUrl} />
      ) : null}
    </>
  )
}
