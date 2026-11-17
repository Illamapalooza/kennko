'use client'

import { formatPesos } from '@/lib/money'
import { DrinkPlaceholder } from './DrinkPlaceholder'
import { drinkPhoto } from './drinkImage'
import { SIZE_VOLUMES } from '@/lib/menu/sizes'
import type { DrinkSize, MenuItemWithPrices } from '@/lib/menu/types'

export function DrinkCard({
  item,
  imageUrl,
  onPick,
}: {
  item: MenuItemWithPrices
  imageUrl: string | null
  onPick: (item: MenuItemWithPrices, size: DrinkSize) => void
}) {
  const photo = drinkPhoto(item.name, imageUrl)
  const soldOut = !item.isAvailable || item.prices.length === 0

  return (
    <article className={`drink${soldOut ? ' is-sold-out' : ''}`}>
      <div className="drink-frame">
        {photo ? (
          <img className="drink-media" src={photo} alt={item.name} loading="lazy" />
        ) : (
          <DrinkPlaceholder name={item.name} />
        )}
        {item.isBestseller ? <span className="drink-flag">★ Bestseller</span> : null}
        {soldOut ? <span className="drink-out">Sold out</span> : null}
      </div>

      <div className="drink-body">
        <h3 className="drink-name">{item.name}</h3>
        {item.description ? <p className="drink-desc">{item.description}</p> : null}

        {/* The price ladder: the printed board's own device, kept because it is
            how regulars already read this menu -- and it turns choosing a size
            into the single tap that starts the order. */}
        <ul className="ladder" aria-label={`Sizes and prices for ${item.name}`}>
          {item.prices.map((price) => (
            <li key={price.size}>
              <button
                type="button"
                className="ladder-row"
                disabled={soldOut}
                onClick={() => onPick(item, price.size)}
              >
                <span className="ladder-size">{price.size}</span>
                <span className="ladder-vol">{SIZE_VOLUMES[price.size]}</span>
                <span className="ladder-rule" aria-hidden="true" />
                <span className="ladder-price">{formatPesos(price.priceCentavos)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </article>
  )
}
