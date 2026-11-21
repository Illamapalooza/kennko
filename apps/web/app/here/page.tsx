import Link from 'next/link'
import type { Metadata } from 'next'
import type { MeView } from '@kennko/core'
import { getCurrentCustomer } from '@/lib/auth/customer'
import { HereCheckin } from '@/components/here/HereCheckin'
import { OrderNav } from '@/components/order/OrderNav'
import { loadMe } from '@/app/account/me'
import { hereNextPath, parseWallCode } from './here'
import '../order/order.css'
import '../account/account.css'
import './here.css'

// A fresh answer every time, and the code (which is in the URL) never travels on as a referrer.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Bring your cat in', robots: { index: false, follow: false }, referrer: 'no-referrer' }

export default async function HerePage({ searchParams }: { searchParams: Promise<{ c?: string | string[] }> }) {
  const code = parseWallCode((await searchParams).c)
  const customer = await getCurrentCustomer()

  if (!code) {
    return (
      <Shell signedIn={!!customer} name={customer?.name}>
        <div className="panel account-card here">
          <h1>Scan the wall</h1>
          <p className="checkout-sub">Scan the QR code on the wall at Kennko.</p>
        </div>
      </Shell>
    )
  }

  if (!customer) {
    return (
      <Shell signedIn={false}>
        <div className="panel account-card here">
          <h1>Sign in to bring your cat in</h1>
          <p className="checkout-sub">
            The code on the wall changes every minute, so sign in quickly. If it has changed, scan the wall again.
          </p>
          <Link className="btn btn-primary here-link" href={hereNextPath(code)}>Sign in</Link>
        </div>
      </Shell>
    )
  }

  let me: MeView | null = null
  try {
    me = await loadMe()
  } catch {
    // unreachable: the retry message below
  }

  if (!me) {
    return (
      <Shell signedIn name={customer.name}>
        <div className="panel account-card here">
          <h1>Bring your cat in</h1>
          <p className="order-error" role="alert">We could not reach Kennko. Scan the wall again in a minute.</p>
        </div>
      </Shell>
    )
  }

  if (!me.customer) {
    return (
      <Shell signedIn name={customer.name}>
        <div className="panel account-card here">
          <h1>Get your Kennko card first</h1>
          <p className="checkout-sub">Your cat comes with your card. Get one, then scan the wall again.</p>
          <Link className="btn btn-primary here-link" href="/account">Get my Kennko card</Link>
        </div>
      </Shell>
    )
  }

  const { cat } = me.customer
  return (
    <Shell signedIn name={customer.name}>
      <div className="panel account-card here">
        <h1>Bring {cat.name} in</h1>
        {cat.hiddenByAdmin ? (
          <p className="account-note" role="status">Kennko has paused your cat on the wall for now.</p>
        ) : null}
        <HereCheckin code={code} name={cat.name} look={cat.look} hidden={cat.hiddenByAdmin} />
      </div>
    </Shell>
  )
}

function Shell({ children, signedIn, name }: { children: React.ReactNode; signedIn: boolean; name?: string }) {
  return (
    <div className="order-shell">
      <div className="order-main order-main-nav">
        <OrderNav place="account" signedIn={signedIn} customerName={name} />
      </div>
      <div className="account stack">{children}</div>
    </div>
  )
}
