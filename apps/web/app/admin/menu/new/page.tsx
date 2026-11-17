import { requireOwner } from '@/lib/auth/session'
import { getServerClient } from '@/lib/supabase/server'
import { MenuItemForm } from '@/components/admin/MenuItemForm'

export default async function NewMenuItemPage() {
  await requireOwner()
  const db = await getServerClient()

  const { data: categories } = await db
    .from('menu_categories')
    .select('id, name')
    .order('sort_order')

  return (
    <>
      <h1>New drink</h1>
      <p className="admin-notice">
        Save the drink first, then reopen it to add a photo.
      </p>
      <MenuItemForm categories={categories ?? []} />
    </>
  )
}
