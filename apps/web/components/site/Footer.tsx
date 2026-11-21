import { InstallAppButton } from '@/components/InstallAppButton'

export function Footer() {
  return (
    <footer>
      <div className="container">
        <div className="k-sticker footer-shell">
          <div>
            <img className="footer-logo" src="/brand/wordmark-white.png" alt="Kennko Coffee" width={895} height={497} />
            <p>Premium coffee, playful drinks and snacks in Villa Kananga, Butuan City.</p>
          </div>
          <nav className="footer-links" aria-label="Kennko on social media">
            <a href="https://www.facebook.com/kennco.cafebxu" target="_blank" rel="noreferrer">
              Facebook
            </a>
            <a href="https://www.instagram.com/kennko.bxu/" target="_blank" rel="noreferrer">
              Instagram
            </a>
            <a href="tel:09305992729">0930 599 2729</a>
          </nav>
          <InstallAppButton label="Add Kennko to your home screen" className="btn btn-secondary" />
          <p className="footer-fine">© 2026 Kennko Coffee. 100% made with love.</p>
        </div>
      </div>
    </footer>
  )
}
