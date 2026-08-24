export function MenuSection() {
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
          <article className="menu-card">
            <img src="/brand/egg-coffee.jpg" alt="Premium coffee from Kennko" />
            <div className="menu-card-body">
              <h3>Premium Coffee</h3>
              <p>Rich, smooth, and made for everyday coffee drinkers.</p>
              <ul className="menu-list">
                <li>Americano</li>
                <li>Coffee Latte</li>
                <li>Spanish Latte</li>
                <li>Vanilla Latte</li>
                <li>White Choco Mocha</li>
                <li>Caramel Macchiato</li>
                <li>Vietnamese Coffee</li>
                <li>Egg Coffee</li>
              </ul>
            </div>
          </article>

          <article className="menu-card">
            <img
              src="/brand/vanilla-milk-cloud-foam-kennko.jpg"
              alt="Kennko signature drink"
            />
            <div className="menu-card-body">
              <h3>Specialty Series</h3>
              <p>Playful signatures with creamy, indulgent twists.</p>
              <ul className="menu-list">
                <li>Coconut Series</li>
                <li>Salted Caramel Oat Latte</li>
                <li>Sea Salt Caramel Oat Latte</li>
                <li>Vanilla Milk Cloud Foam</li>
                <li>Strawberry Cloud Soda</li>
              </ul>
            </div>
          </article>

          <article className="menu-card">
            <img src="/brand/kennko_new-menu.png" alt="Kennko menu board" />
            <div className="menu-card-body">
              <h3>Non-Coffee Favorites</h3>
              <p>Comforting and refreshing picks beyond espresso.</p>
              <ul className="menu-list">
                <li>Signature Choco</li>
                <li>Matcha Latte</li>
                <li>Strawberry Milk</li>
                <li>Berry Matcha</li>
                <li>Hot options available</li>
              </ul>
            </div>
          </article>
        </div>
      </div>
    </section>
  )
}
