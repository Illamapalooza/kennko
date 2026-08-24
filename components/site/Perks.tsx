export function Perks() {
  return (
    <section id="perks">
      <div className="container">
        <div className="section-head">
          <h2>Perks that make repeat visits sweeter.</h2>
          <p>
            Kennko’s loyalty card keeps things simple: collect stamps, get
            rewarded, and turn your regular drink run into extra value.
          </p>
        </div>

        <div className="perks-grid">
          <article className="perk-card">
            <span className="kicker">Loyalty card</span>
            <h3>Collect stamps. Unlock rewards.</h3>
            <p>
              Grab a perks card, keep coming back, and earn little wins along the
              way. It’s a small extra that makes your coffee routine more fun.
            </p>
            <div className="perk-steps">
              <div className="step">
                <strong>4</strong>
                Collect four stamps and get a free upsize.
              </div>
              <div className="step">
                <strong>8</strong>
                Collect eight stamps and get a free drink.
              </div>
            </div>
          </article>

          <article className="hero-card">
            <img src="/brand/kennko-perks-card.jpg" alt="Kennko perks card" />
          </article>
        </div>
      </div>
    </section>
  )
}
