import { CatToon } from '@kennko/cats'

// Stamps on the drawn card: 1 to 3 already collected, 4 is the free upsize, 8 the free drink.
const STAMPS = [1, 2, 3, 4, 5, 6, 7, 8] as const
const COLLECTED = 3
const REWARDS: Partial<Record<(typeof STAMPS)[number], string>> = { 4: 'Free upsize', 8: 'Free drink' }

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

          <figure className="stamp-card" aria-label="Kennko perks card: eight stamps, a free upsize at four and a free drink at eight">
            <CatToon coat="cream" pose="sit" className="perch perch-sit perch-right" />
            <figcaption>
              <span>Kennko</span> perks card
            </figcaption>
            <ol className="stamp-grid">
              {STAMPS.map((n) => (
                <li
                  key={n}
                  className={[n <= COLLECTED ? 'is-stamped' : '', REWARDS[n] ? 'is-reward' : ''].join(' ').trim() || undefined}
                >
                  {n <= COLLECTED ? (
                    <img src="/brand/sticker-smiley.png" alt="" />
                  ) : REWARDS[n] ? (
                    <span>{REWARDS[n]}</span>
                  ) : (
                    <span>{n}</span>
                  )}
                </li>
              ))}
            </ol>
          </figure>
        </div>
      </div>
    </section>
  )
}
