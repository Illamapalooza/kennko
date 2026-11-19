import { saveMenuItem } from '@/app/admin/menu/actions'
import { CategoryPriceFields } from './CategoryPriceFields'
import type { CategoryKind } from '@/app/admin/menu/format'
import { ImageUploadField } from './ImageUploadField'
import type { AdminMenuItem } from '@/lib/menu/types'

type EditableItem = AdminMenuItem & { categoryId: string; imageUrl: string | null }

export function MenuItemForm({
  item,
  categories,
}: {
  item?: EditableItem
  categories: { id: string; name: string; kind: CategoryKind }[]
}) {
  return (
    <>
      <form action={saveMenuItem}>
        {item ? <input type="hidden" name="id" value={item.id} /> : null}

        <label className="admin-field">
          <span>Name</span>
          <input name="name" defaultValue={item?.name ?? ''} required />
        </label>

        <label className="admin-field">
          <span>Description (optional)</span>
          <textarea name="description" defaultValue={item?.description ?? ''} />
        </label>

        <CategoryPriceFields
          categories={categories}
          categoryId={item?.categoryId ?? ''}
          prices={item?.prices ?? []}
        />

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
