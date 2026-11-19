import { formatPesos } from '@/lib/money'
import { CatToon } from '@kennko/cats'
import type { FoodItem } from '@/lib/menu/queries'

// Art is keyed by item name; an item with no art gets no picture.
const FOOD_ART: Record<string, string> = {
  Cookies: '/brand/food-cookies.png',
  Empanada: '/brand/food-empanada.png',
  Fries: '/brand/food-fries.png',
}

export function FoodMenu({ items }: { items: FoodItem[] }) {
  return (
    <section id="food">
      <div className="container">
        <div className="k-sticker food-board">
          <CatToon coat="black" pose="peek" className="perch perch-climb" />
          <img className="food-sticker food-sticker-eyes" src="/brand/sticker-eyes.png" alt="" />
          <img className="food-sticker food-sticker-smiley" src="/brand/sticker-smiley.png" alt="" />

          <h2 className="food-title k-outlined">
            Kennko&rsquo;s
            <br />
            food menu
          </h2>

          <div className="food-rows">
            {items.map((item) => {
              const image = FOOD_ART[item.name]
              const titleId = `food-${item.id}`
              return (
                <article className="k-sticker-row food-row" key={item.id} aria-labelledby={titleId}>
                  <div className="food-art">
                    {image && <img src={image} alt={`${item.name} illustration`} loading="lazy" />}
                  </div>
                  <div className="food-info">
                    <h3 id={titleId}>{item.name}</h3>
                    <div className="food-info-foot">
                      <ul>
                        {item.options.map((option) => (
                          <li key={option}>{option}</li>
                        ))}
                      </ul>
                      <span className="k-price">{formatPesos(item.priceCentavos)}</span>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>

          <p className="food-foot">100% made with love</p>
        </div>
      </div>
    </section>
  )
}
