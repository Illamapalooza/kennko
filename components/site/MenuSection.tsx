import { formatPesos } from '@/lib/money'
import type { MenuCategoryWithItems, MenuItemWithPrices } from '@/lib/menu/types'

const CATEGORY_IMAGES: Record<string, string> = {
  'Premium Classics': '/brand/egg-coffee.jpg',
  "Barista's Choice": '/brand/sea-salt-caramel-oat-latte.jpg',
  'Sweet Sips': '/brand/strawberry-cloud-soda.jpg',
  'Matcha Series': '/brand/coconut-series.jpg',
}

const CATEGORY_BLURBS: Record<string, string> = {
  'Premium Classics': 'Rich, smooth, and made for everyday coffee drinkers.',
  "Barista's Choice": 'House specialities the baristas are proudest of.',
  'Sweet Sips': 'Comforting and refreshing picks beyond espresso.',
  'Matcha Series': 'Stone-ground matcha, from classic to dirty.',
}

function startingPrice(item: MenuItemWithPrices): string {
  if (item.prices.length === 0) return ''
  const cheapest = item.prices.reduce(
    (min, price) => (price.priceCentavos < min ? price.priceCentavos : min),
    Number.POSITIVE_INFINITY,
  )
  return formatPesos(cheapest)
}

export function MenuSection({ categories }: { categories: MenuCategoryWithItems[] }) {
  return (
    <section id="menu">
      <div className="container">
        <div className="section-head">
          <h2>Menu highlights</h2>
          <p>
            From classic espresso-based drinks to creamy cloud favorites and
            refreshing fruit-forward picks, there’s something here for every
            mood.
          </p>
        </div>

        <div className="menu-grid">
          {categories.map((category) => (
            <article className="menu-card" key={category.id}>
              {CATEGORY_IMAGES[category.name] ? (
                <img
                  src={CATEGORY_IMAGES[category.name]}
                  alt={`${category.name} from Kennko`}
                />
              ) : null}
              <div className="menu-card-body">
                <h3>{category.name}</h3>
                {CATEGORY_BLURBS[category.name] ? (
                  <p>{CATEGORY_BLURBS[category.name]}</p>
                ) : null}
                <ul className="menu-list">
                  {category.items.map((item) => (
                    <li
                      key={item.id}
                      className={item.isAvailable ? undefined : 'is-unavailable'}
                    >
                      <span>
                        {item.name}
                        {item.isBestseller ? <span className="star" aria-label="Bestseller"> ★</span> : null}
                      </span>
                      <span className="menu-price">
                        {item.isAvailable ? startingPrice(item) : 'Sold out'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
