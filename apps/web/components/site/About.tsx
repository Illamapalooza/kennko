export function About() {
  return (
    <section id="about">
      <div className="container">
        <div className="section-head">
          <h2>Built for coffee runs, catch-ups, and cravings.</h2>
          <p>
            Founded in 2023, Kennko Coffee is all about serving premium drinks in
            a bold, approachable space — whether you want your daily latte, a
            creamy specialty favorite, or something sweet and refreshing.
          </p>
        </div>

        <div className="about-grid">
          <article className="section-card blue">
            <span className="kicker">Why people come back</span>
            <p>
              The menu keeps things exciting: familiar coffee classics,
              non-coffee comfort picks, and standout specialty drinks that feel
              fun without trying too hard.
            </p>
            <div className="pill-row">
              <span className="pill">Premium coffee</span>
              <span className="pill">Non-coffee favorites</span>
              <span className="pill">Specialty series</span>
              <span className="pill">Youthful atmosphere</span>
            </div>
          </article>

          <article className="section-card">
            <span className="kicker">Cafe personality</span>
            <p>
              Bold. Playful. Friendly. Kennko’s look leans bright, upbeat, and
              easy to remember — the kind of spot that works for quick coffee
              breaks, casual hangs, and repeat visits.
            </p>
            <div className="pill-row">
              <span className="pill">Founded in 2023</span>
              <span className="pill">Villa Kananga</span>
              <span className="pill">Fun and approachable</span>
            </div>
          </article>
        </div>
      </div>
    </section>
  )
}
