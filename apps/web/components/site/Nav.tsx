export function Nav() {
  // Read at build time, like any NEXT_PUBLIC value. Flipping the flag needs a
  // redeploy, which is the right cadence for opening ordering to the public.
  const orderingOn = process.env.NEXT_PUBLIC_ORDERING_ENABLED === 'true'

  return (
    <header className="nav">
      <div className="container nav-inner">
        <a className="brand" href="#top" aria-label="Kennko Coffee home">
          <img src="/brand/wordmark-blue.png" alt="Kennko Coffee" width={895} height={497} />
        </a>

        <nav className="nav-links" aria-label="Primary navigation">
          <a href="#about">About</a>
          <a href="#menu">Menu</a>
          <a href="#food">Food</a>
          <a href="#perks">Perks</a>
          <a href="#visit">Visit</a>
          <a href="/account">My card</a>
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
