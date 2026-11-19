import Link from 'next/link'
import { getCurrentStaff } from '@/lib/auth/session'
import { getAdminMenu } from './actions'
import { priceRange } from './format'
import { readPublishNotice } from './publish-notice'
import { AvailabilityToggle } from '@/components/admin/AvailabilityToggle'
import { PublishMenuButton } from '@/components/admin/PublishMenuButton'

export default async function AdminMenuPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; publish?: string; reason?: string }>
}) {
  const { denied, publish, reason } = await searchParams
  const staff = await getCurrentStaff()
  const categories = await getAdminMenu()
  const isOwner = staff?.role === 'owner'
  const publishNotice = isOwner ? readPublishNotice({ publish, reason }) : null

  return (
    <>
      <h1>Menu</h1>

      {denied === 'owner-only' ? (
        <p className="admin-notice" role="alert">
          Only the owner can edit menu items and prices. You can still mark items
          sold out.
        </p>
      ) : null}

      {publishNotice ? (
        <p className="admin-notice" role="alert">
          {publishNotice}
        </p>
      ) : null}

      {isOwner ? (
        <p>
          <Link className="btn btn-primary" href="/admin/menu/new">
            Add a drink
          </Link>{' '}
          <PublishMenuButton />
        </p>
      ) : null}

      {categories.map((category) => (
        <section key={category.id}>
          <h2>{category.name}</h2>

          <div className="admin-cards">
            {category.items.map((item) => (
              <article className="section-card" key={item.id}>
                <strong>
                  {item.name}
                  {item.isBestseller ? <span className="star" aria-label="Bestseller"> ★</span> : null}
                </strong>
                <p>{priceRange(item.prices)}</p>
                <p>{item.isAvailable ? 'Available' : 'Sold out'}</p>
                <AvailabilityToggle itemId={item.id} isAvailable={item.isAvailable} />
                {isOwner ? <Link href={`/admin/menu/${item.id}`}>Edit</Link> : null}
              </article>
            ))}
          </div>

          <table className="admin-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Price</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {category.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.name}
                    {item.isBestseller ? <span className="star" aria-label="Bestseller"> ★</span> : null}
                  </td>
                  <td>{priceRange(item.prices)}</td>
                  <td>{item.isAvailable ? 'Available' : 'Sold out'}</td>
                  <td>
                    <AvailabilityToggle
                      itemId={item.id}
                      isAvailable={item.isAvailable}
                    />
                    {isOwner ? (
                      <Link href={`/admin/menu/${item.id}`}>Edit</Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  )
}
