import { formatPesos } from '@/lib/money'
import type { MenuCategoryWithItems, MenuItemWithPrices } from '@/lib/menu/types'
import { CupSticker, type CupFlavour, type CupPlate } from './CupSticker'
import { CatToon, type CatCoat, type CatPose } from '@kennko/cats'

// Each category gets a drawn cup on its own plate colour, in the food-menu flyer's style.
// A category added in admin without an entry here falls back to a plain coffee cup.
// A cat from the wall's cast perches on each card: peeking over it, standing on it, napping on it.
type Perch = { coat: CatCoat; pose: CatPose; spot: string }
const CATEGORY_ART: Record<string, { flavour: CupFlavour; plate: CupPlate; cat: Perch }> = {
  'Premium Classics': { flavour: 'coffee', plate: 'yellow', cat: { coat: 'ginger', pose: 'peek', spot: 'perch-peek perch-right' } },
  "Barista's Choice": { flavour: 'caramel', plate: 'orange', cat: { coat: 'tuxedo', pose: 'wave', spot: 'perch-sit perch-left' } },
  'Sweet Sips': { flavour: 'strawberry', plate: 'pink', cat: { coat: 'calico', pose: 'nap', spot: 'perch-nap perch-right' } },
  'Matcha Series': { flavour: 'matcha', plate: 'sky', cat: { coat: 'tabby', pose: 'peek', spot: 'perch-peek perch-left' } },
}
const DEFAULT_ART = { flavour: 'coffee', plate: 'yellow', cat: null } as const

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
  const orderingOn = process.env.NEXT_PUBLIC_ORDERING_ENABLED === 'true'

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
          {categories.map((category) => {
            const art = CATEGORY_ART[category.name] ?? DEFAULT_ART
            return (
              <article className="menu-card" key={category.id}>
                {art.cat ? (
                  <CatToon coat={art.cat.coat} pose={art.cat.pose} className={`perch ${art.cat.spot}`} />
                ) : null}
                <div className={`menu-card-art plate-${art.plate}`}>
                  <CupSticker flavour={art.flavour} plate={art.plate} />
                </div>
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
            )
          })}
        </div>

        {orderingOn ? (
          <div className="menu-cta">
            <a className="btn btn-primary" href="/order">
              Order for pickup or delivery
            </a>
          </div>
        ) : null}
      </div>
    </section>
  )
}
