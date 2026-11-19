import { getCurrentStaff } from '@/lib/auth/session'
import { getAdminMenu } from './actions'
import { MenuTable } from '@/components/admin/menu/MenuTable'

export default async function AdminMenuPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; filter?: string }>
}) {
  const { denied, filter } = await searchParams
  const [staff, menu] = await Promise.all([getCurrentStaff(), getAdminMenu()])
  const isOwner = staff?.role === 'owner'

  return (
    <>
      <h1>Menu</h1>

      {denied === 'owner-only' ? (
        <p className="admin-notice" role="alert">
          Only the owner can edit menu items and prices. You can still mark items sold out.
        </p>
      ) : null}

      <MenuTable menu={menu} isOwner={isOwner} initialSoldOut={filter === 'soldout'} />
    </>
  )
}
