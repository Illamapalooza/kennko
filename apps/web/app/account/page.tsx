import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentCustomer } from '@/lib/auth/customer'
import { GoogleSignIn } from '@/components/order/GoogleSignIn'
import { EmailSignIn } from '@/components/account/EmailSignIn'
import { JoinForm } from '@/components/account/JoinForm'
import { StampCard } from '@/components/account/StampCard'
import { CatCustomiser } from '@/components/account/CatCustomiser'
import { DeleteAccount } from '@/components/account/DeleteAccount'
import { RenameCard } from '@/components/account/RenameCard'
import { safeNextPath } from '@/lib/auth/redirect'
import { OrderNav } from '@/components/order/OrderNav'
import { signOutCustomer } from './actions'
import { loadCosmetics, loadMe } from './me'
import { qrSvg } from './qr'
import '../order/order.css'
import './account.css'

export const dynamic = 'force-dynamic'

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const { error, next } = await searchParams
  const customer = await getCurrentCustomer()

  // Only a sign-in that came from somewhere (for example /orders) goes back there; otherwise this is the account page.
  const target = safeNextPath(next ?? null, '/account')
  if (customer && next && target !== '/account') redirect(target)

  if (!customer) {
    const after = safeNextPath(next ?? null, '/account')
    return (
      <Shell signedIn={false}>
        <div className="panel account-card">
          <h1>Sign in to Kennko</h1>
          <p className="checkout-sub">
            Get a Kennko card with stamps and points, and see your orders. No password: use Google, or we email you a link.
          </p>

          <GoogleSignIn next={after} />
          <p className="account-or" aria-hidden="true"><span>or</span></p>
          <EmailSignIn next={after} />

          {error ? (
            <p className="order-error" role="alert">Sign-in did not finish: {error}</p>
          ) : null}

          <p className="account-guest">
            You do not need an account to order. <Link href="/order">Order as a guest</Link>.
          </p>
        </div>
      </Shell>
    )
  }

  const { customer: card } = await loadMe()

  if (!card) {
    return (
      <Shell signedIn name={customer.name}>
        <div className="panel account-card">
          <h1>Get my Kennko card</h1>
          <p className="checkout-sub">
            Earn a stamp on every drink: 8 stamps is a free drink. Collect points on what you spend, too.
            Show your code at the counter and we do the rest.
          </p>
          <JoinForm />
        </div>
        <div className="panel account-card account-links">
          <Link href="/orders">See my orders</Link>
          <p className="account-guest">Signed in as {customer.email}</p>
          <DeleteAccount hasCard={false} />
        </div>
      </Shell>
    )
  }

  const svg = await qrSvg(card.publicCode)
  const catalogue = await loadCosmetics()
  return (
    <Shell signedIn name={customer.name} wide>
      <div className="panel account-card kcard area-card">
        <h1>Your Kennko card</h1>
        <div className="qr" role="img" aria-label={`QR code for ${card.publicCode}`} dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="kcode" aria-label="Your code">{card.publicCode}</p>
        <p className="account-guest">Show this at the counter, or read the code out.</p>
      </div>

      <div className="area-stamps">
        <StampCard customer={card} />
      </div>

      <div className="area-cat">
        <CatCustomiser cat={card.cat} owned={card.owned} points={card.points} catalogue={catalogue} />
      </div>

      <div className="panel account-card area-settings">
        <RenameCard name={card.displayName} />
        <p className="account-guest">Signed in as {customer.email}</p>
        <p className="account-links"><Link href="/orders">See my orders</Link></p>
        <form action={signOutCustomer}>
          <button type="submit" className="quiet-btn">Sign out</button>
        </form>
      </div>

      <div className="panel account-card area-delete">
        <DeleteAccount hasCard />
      </div>
    </Shell>
  )
}

function Shell({ children, signedIn, name, wide = false }: { children: React.ReactNode; signedIn: boolean; name?: string; wide?: boolean }) {
  return (
    <div className="order-shell">
      <div className="order-main order-main-nav">
        <OrderNav place="account" signedIn={signedIn} customerName={name} />
      </div>
      <div className={wide ? 'account stack account-wide' : 'account stack'}>{children}</div>
    </div>
  )
}
