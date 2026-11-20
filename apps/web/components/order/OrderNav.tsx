import { navLinks, type NavPlace } from './nav'

type Props = { place: NavPlace; signedIn: boolean; customerName?: string }

export function OrderNav({ place, signedIn, customerName }: Props) {
  return (
    <nav className="order-nav" aria-label="Ordering">
      <a className="order-nav-brand" href="/">Kennko</a>
      <ul className="order-nav-links">
        {navLinks(place, signedIn, customerName).map((link) => (
          <li key={link.label}>
            <a href={link.href} aria-current={link.current ? 'page' : undefined}>
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
