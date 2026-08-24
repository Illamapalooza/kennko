export function Nav() {
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
        </nav>
      </div>
    </header>
  )
}
