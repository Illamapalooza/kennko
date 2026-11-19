import { CupSticker } from './CupSticker'
import { CatToon } from '@kennko/cats'

const TICKER = ['Premium coffee', 'Sweet sips', 'Matcha series', 'Cookies & fries', 'Free upsize at 4 stamps', 'Made with love']

export function Hero() {
  const orderingOn = process.env.NEXT_PUBLIC_ORDERING_ENABLED === 'true'

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="container">
        <div className="k-sticker hero-board">
          <img className="hero-sticker hero-sticker-eyes" src="/brand/sticker-eyes.png" alt="" />

          <div className="hero-copy">
            <span className="hero-tag">
              Villa Kananga · Butuan City<span className="hero-tag-extra"> · Since 2023</span>
            </span>
            <h1 id="hero-title" className="k-outlined">
              Bold coffee.
              <br />
              Fun sips.
              <br />
              Good energy.
            </h1>
            <p>
              Premium coffee, sweet non-coffee favourites, matcha and snacks, served loud, cheerful and
              a little silly on CT. Montalban St.
            </p>
            <div className="hero-cta">
              {orderingOn ? (
                <a className="btn btn-primary" href="/order">
                  Order now
                </a>
              ) : null}
              <a className={orderingOn ? 'btn btn-secondary' : 'btn btn-primary'} href="#menu">
                See the menu
              </a>
              <a className="btn btn-secondary" href="#visit">
                Visit the cafe
              </a>
            </div>
          </div>

          <div className="hero-art" aria-hidden="true">
            <div className="hero-plate hero-plate-cup">
              <CatToon coat="ginger" pose="peek" className="perch perch-peek perch-left" />
              <CupSticker flavour="caramel" plate="yellow" />
            </div>
            <div className="hero-plate hero-plate-cup-2">
              <CatToon coat="calico" pose="wave" className="perch perch-sit perch-right" />
              <CupSticker flavour="strawberry" plate="pink" />
            </div>
            <div className="hero-plate hero-plate-food">
              <img src="/brand/food-cookies.png" alt="" />
            </div>
            <img className="hero-sticker hero-sticker-smiley" src="/brand/sticker-smiley.png" alt="" />
            <span className="hero-badge">
              Free drink
              <small>at 8 stamps</small>
            </span>
          </div>
        </div>
      </div>

      <div className="ticker" aria-hidden="true">
        <div className="ticker-track">
          {[...TICKER, ...TICKER].map((word, i) => (
            <span key={i}>{word} ★</span>
          ))}
        </div>
      </div>
    </section>
  )
}
