// The cafe's pin, shared by the map embed and the route link.
const CAFE_PIN = '8.9268972,125.5321737'

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
          <article className="about-card about-card-blue visit-card">
            <span className="about-kicker">Visit us</span>
            <h3 className="visit-address">
              CT. Montalban St., Villa Kananga
            </h3>
            <p>Butuan City, Philippines 8600</p>
            <ul className="tag-row">
              <li>0930 599 2729</li>
              <li>Founded by Kenn Baliling</li>
              <li>Since 2023</li>
            </ul>
            <div className="hero-cta">
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
                Every drink and snack is on this page, with live prices. Message the page for anything
                else.
              </p>
              <a className="contact-link" href="#menu">
                Back to the menu
              </a>
            </article>
          </div>
        </div>

        <div className="map-card">
          <div className="map-frame">
            {/* Keyless Google embed in directions mode: draws the drive from SM City Butuan, the
                landmark most visitors know, to the cafe's pin. No API key, nothing metered. */}
            <iframe
              title="Driving route on Google Maps from SM City Butuan to Kennko Coffee on CT. Montalban St., Villa Kananga"
              src={`https://www.google.com/maps?saddr=SM+City+Butuan&daddr=${CAFE_PIN}&dirflg=d&hl=en&output=embed`}
              loading="lazy"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
          <div className="map-foot">
            <div className="route-note">
              <p>
                From SM City Butuan
                <span>About 2.6 km, around 6 minutes by car. Most of the way is straight down CT. Montalban St. into Villa Kananga.</span>
              </p>
            </div>
            <div className="map-actions">
              <a
                className="btn btn-secondary"
                href={`https://www.google.com/maps/dir/?api=1&origin=SM+City+Butuan&destination=${CAFE_PIN}&travelmode=driving`}
                target="_blank"
                rel="noreferrer"
              >
                Route from SM
              </a>
              <a
                className="btn btn-primary"
                href="https://maps.app.goo.gl/Nw6txjdRjk5er2f77"
                target="_blank"
                rel="noreferrer"
              >
                Directions from you
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
