import { getCurrentStaff } from '@/lib/auth/session'
import { getAdminMenu } from './actions'
import { menuImageUrl } from './format'
import { MenuTable } from '@/components/admin/menu/MenuTable'
import { MenuItemDrawer } from '@/components/admin/menu/MenuItemDrawer'

export default async function AdminMenuPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; filter?: string; edit?: string; new?: string }>
}) {
  const { denied, filter, edit, new: isNew } = await searchParams
  const [staff, menu] = await Promise.all([getCurrentStaff(), getAdminMenu()])
  const isOwner = staff?.role === 'owner'

  const found = edit ? menu.categories.flatMap((c) => c.items).find((i) => i.id === edit) : undefined
  const drawerItem = found ? { ...found, imageUrl: menuImageUrl(found.imagePath) } : null
  const showDrawer = isOwner && (found !== undefined || (isNew === '1' && !edit))

  return (
    <>
      <h1>Menu</h1>

      {denied === 'owner-only' ? (
        <p className="admin-notice" role="alert">
          Only the owner can edit menu items and prices. You can still mark items sold out.
        </p>
      ) : null}

      <MenuTable menu={menu} isOwner={isOwner} initialSoldOut={filter === 'soldout'} />

      {showDrawer ? (
        <MenuItemDrawer
          key={drawerItem?.id ?? 'new'}
          item={drawerItem}
          categories={menu.categories.map(({ id, name, kind }) => ({ id, name, kind }))}
          optionGroups={menu.optionGroups}
          isOwner={isOwner}
        />
      ) : null}
    </>
  )
}
