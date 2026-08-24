export function Nav() {
  // Read at build time, like any NEXT_PUBLIC value. Flipping the flag needs a
  // redeploy, which is the right cadence for opening ordering to the public.
  const orderingOn = process.env.NEXT_PUBLIC_ORDERING_ENABLED === 'true'

  return (
    <header className="nav">
      <div className="container nav-inner">
        <a className="brand" href="#top" aria-label="Kennko Coffee home">
          <img src="/brand/kennko.png" alt="Kennko Coffee logo" />
          <span>KENNKO COFFEE</span>
        </a>

        <nav className="nav-links" aria-label="Primary navigation">
          <a href="#about">About</a>
          <a href="#menu">Menu</a>
          <a href="#perks">Perks</a>
          <a href="#visit">Visit</a>
          {orderingOn ? (
            <a className="nav-order" href="/order">
              Order now
            </a>
          ) : null}
        </nav>
      </div>
    </header>
  )
}
