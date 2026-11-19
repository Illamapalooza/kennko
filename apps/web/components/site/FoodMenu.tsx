import { formatPesos } from '@/lib/money'
import { CatToon } from '@kennko/cats'

// Food is not in the ordering system yet, so it lives here, copied from the 2026 food-menu flyer
// (brand/assets/food-menu/). Move it into packages/core once food can be ordered or rung up on the till.
type FoodItem = {
  name: string
  options: string[]
  priceCentavos: number
  image: string
}

const FOOD: FoodItem[] = [
  {
    name: 'Cookies',
    options: ['Original', 'Chocolate', 'Red Velvet'],
    priceCentavos: 6000,
    image: '/brand/food-cookies.png',
  },
  {
    name: 'Empanada',
    options: ['Chicken'],
    priceCentavos: 4500,
    image: '/brand/food-empanada.png',
  },
  {
    name: 'Fries',
    options: ['Original', 'Cheese', 'BBQ', 'Sour Cream'],
    priceCentavos: 8500,
    image: '/brand/food-fries.png',
  },
]

export function FoodMenu() {
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
            {FOOD.map((item) => {
              const titleId = `food-${item.name.toLowerCase()}`
              return (
                <article className="k-sticker-row food-row" key={item.name} aria-labelledby={titleId}>
                  <div className="food-art">
                    <img src={item.image} alt={`${item.name} illustration`} loading="lazy" />
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
