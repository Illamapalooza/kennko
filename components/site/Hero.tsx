export function Hero() {
  return (
    <section className="hero">
      <div className="container hero-shell">
        <div className="hero-copy">
          <span className="eyebrow">
            Villa Kananga, Butuan City • Premium coffee &amp; playful drinks
          </span>
          <h1>
            Bold coffee.
            <br />
            Fun sips.
            <br />
            Good energy.
          </h1>
          <p>
            Kennko Coffee brings premium coffee, signature non-coffee favorites,
            and crowd-pleasing specialty drinks to Villa Kananga — all wrapped in
            a fun, youthful vibe that feels easy to love.
          </p>
          <div className="cta-row">
            <a
              className="btn btn-primary"
              href="https://www.facebook.com/kennco.cafebxu"
              target="_blank"
              rel="noreferrer"
            >
              Message on Facebook
            </a>
            <a className="btn btn-secondary" href="#visit">
              Visit the Cafe
            </a>
          </div>
        </div>

        <div className="hero-grid">
          <div className="hero-card tall">
            <img src="/brand/kennco-people.jpg" alt="People enjoying Kennko Coffee" />
          </div>
          <div className="hero-card short">
            <img src="/brand/egg-coffee.jpg" alt="Kennko egg coffee" />
          </div>
          <div className="hero-card short">
            <img
              src="/brand/strawberry-cloud-soda.jpg"
              alt="Kennko strawberry cloud soda"
            />
          </div>
        </div>
      </div>
    </section>
  )
}
