export function About() {
  return (
    <section id="about">
      <div className="container">
        <div className="section-head">
          <h2>Built for coffee runs, catch-ups and cravings.</h2>
          <p>
            Founded in 2023 by Kenn Baliling, Kennko serves premium drinks in a bold, easy-going space.
            Come for your daily latte, a creamy specialty, or something sweet and cold.
          </p>
        </div>

        <div className="about-grid">
          <article className="about-card about-card-blue">
            <span className="about-kicker">Why people come back</span>
            <p>
              Familiar coffee classics, non-coffee comfort picks and standout specialty drinks that are
              fun without trying too hard. Now with cookies, empanada and fries on the side.
            </p>
            <ul className="tag-row">
              <li>Premium coffee</li>
              <li>Non-coffee favourites</li>
              <li>Matcha series</li>
              <li>Snacks</li>
            </ul>
          </article>

          <article className="about-card">
            <span className="about-kicker">Cafe personality</span>
            <p>
              Bold. Playful. Friendly. Bright blue, loud stickers and good music: the kind of spot that
              works for a quick coffee break, a long catch-up or a study session.
            </p>
            <ul className="tag-row">
              <li>Since 2023</li>
              <li>Villa Kananga</li>
              <li>Fun and approachable</li>
            </ul>
          </article>
        </div>
      </div>
    </section>
  )
}
