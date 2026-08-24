export function Visit() {
  return (
    <section id="visit">
      <div className="container">
        <div className="section-head">
          <h2>See you at Kennko.</h2>
          <p>
            Drop by for your next coffee break, sweet fix, or quick catch-up.
            You’ll find Kennko on CT. Montalban St., ready with drinks that hit
            the spot.
          </p>
        </div>

        <div className="visit-grid">
          <article className="section-card blue">
            <span className="kicker">Visit us</span>
            <h3 style={{ fontSize: '2rem', marginBottom: '12px' }}>
              CT. Montalban St., Villa Kananga
            </h3>
            <p>Butuan City, Philippines 8600</p>
            <div className="pill-row">
              <span className="pill">0930 599 2729</span>
              <span className="pill">Founded by Kenn Baliling</span>
              <span className="pill">Since 2023</span>
            </div>
            <div className="cta-row">
              <a className="btn btn-primary" href="tel:09305992729">
                Call Kennko
              </a>
              <a
                className="btn btn-secondary"
                href="https://www.instagram.com/kennko.bxu/"
                target="_blank"
                rel="noreferrer"
              >
                View Instagram
              </a>
            </div>
          </article>

          <div className="contact-stack">
            <article className="contact-card">
              <h3>Facebook</h3>
              <p>Message the cafe for updates, inquiries, and promos.</p>
              <a
                className="contact-link"
                href="https://www.facebook.com/kennco.cafebxu"
                target="_blank"
                rel="noreferrer"
              >
                facebook.com/kennco.cafebxu
              </a>
            </article>

            <article className="contact-card">
              <h3>Instagram</h3>
              <p>See drink shots, brand updates, and what’s new in-store.</p>
              <a
                className="contact-link"
                href="https://www.instagram.com/kennko.bxu/"
                target="_blank"
                rel="noreferrer"
              >
                @kennko.bxu
              </a>
            </article>

            <article className="contact-card">
              <h3>Need the full menu?</h3>
              <p>
                Check the visual menu in-store or message the page directly for
                current offerings and availability.
              </p>
            </article>
          </div>
        </div>

        <div className="map-card">
          <div className="map-frame">
            <iframe
              title="Kennko Coffee location on Google Maps — CT. Montalban St., Villa Kananga, Butuan City"
              src="https://www.google.com/maps?q=8.9268972,125.5321737&z=17&hl=en&output=embed"
              loading="lazy"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
          <div className="map-foot">
            <p>
              CT. Montalban St., Villa Kananga
              <span>Butuan City, Philippines 8600</span>
            </p>
            <a
              className="btn btn-primary"
              href="https://maps.app.goo.gl/Nw6txjdRjk5er2f77"
              target="_blank"
              rel="noreferrer"
            >
              Get directions
            </a>
          </div>
        </div>

        <div className="banner">
          <img src="/brand/kennco-banner_2.png" alt="Kennko banner graphic" />
        </div>
      </div>
    </section>
  )
}
