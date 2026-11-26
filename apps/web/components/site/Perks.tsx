import { CatToon } from '@kennko/cats'

import { PerksCard } from './PerksCard'

// The drawn card shows three stamps already collected.
const DEMO = Array.from({ length: 8 }, (_, i) => ({ stamped: i < 3 }))

export function Perks() {
  return (
    <section id="perks">
      <div className="container">
        <div className="section-head">
          <h2>Perks that make repeat visits sweeter.</h2>
          <p>
            Kennko&rsquo;s loyalty card keeps it simple: collect stamps, get rewarded, and turn your regular
            drink run into extra value.
          </p>
        </div>

        <div className="perks-grid">
          <article className="about-card perk-card">
            <span className="about-kicker">Loyalty card</span>
            <h3>Collect stamps. Unlock rewards.</h3>
            <p>One stamp per drink. Ask the barista for a perks card on your next visit.</p>
            <div className="perk-steps">
              <div className="step">
                <strong>4</strong>
                stamps get you a free upsize.
              </div>
              <div className="step">
                <strong>8</strong>
                stamps get you a free drink.
              </div>
            </div>
          </article>

          <div className="perks-card-wrap">
            <CatToon coat="cream" pose="sit" className="perch perch-sit perch-right" />
            <PerksCard slots={DEMO} label="Kennko perks card: four stamps for a free upsize, eight stamps for a free drink, three collected" />
          </div>
        </div>
      </div>
    </section>
  )
}
