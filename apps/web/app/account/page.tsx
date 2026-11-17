import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentCustomer } from '@/lib/auth/customer'
import { GoogleSignIn } from '@/components/order/GoogleSignIn'
import { safeNextPath } from '@/lib/auth/redirect'
import '../order/order.css'

export const dynamic = 'force-dynamic'

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const { error, next } = await searchParams
  const customer = await getCurrentCustomer()

  if (customer) redirect(safeNextPath(next ?? null))

  return (
    <div className="order-shell">
      <div className="account">
        <div className="panel account-card">
          <h1>Sign in to see your orders</h1>
          <p className="checkout-sub">
            Kennko uses Google so there is no password to remember. Orders you
            placed as a guest with the same Gmail address show up here too.
          </p>

          <GoogleSignIn next={safeNextPath(next ?? null)} />

          {error ? (
            <p className="order-error" role="alert">
              Sign-in did not finish: {error}
            </p>
          ) : null}

          <p className="account-guest">
            You do not need an account to order.{' '}
            <Link href="/order">Order as a guest</Link>.
          </p>
        </div>
      </div>
    </div>
  )
}
