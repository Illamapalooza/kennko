import Link from 'next/link'
import { PRIVACY_VERSION } from '@/lib/privacy'
import '../order/order.css'
import '../account/account.css'

export const metadata = { title: 'Privacy notice · Kennko Coffee' }

// DRAFT text: Julius reviews it before launch (Plan 7, Task 12). Change PRIVACY_VERSION when the meaning changes.
export default function PrivacyPage() {
  return (
    <div className="order-shell">
      <div className="account privacy">
        <div className="panel account-card">
          <p><Link href="/account">← Back to my account</Link></p>
          <h1>Privacy notice</h1>
          <p className="checkout-sub">
            Kennko Coffee, CT. Montalban St., Villa Kananga, Butuan City. An account is optional. You can always order as a guest.
          </p>

          <h2>What we keep</h2>
          <ul>
            <li>Your sign-in email, or the Google account name and email you signed in with.</li>
            <li>A display name for your card. You can change it.</li>
            <li>Your Kennko card: its code, your stamps and when you got them, and your points.</li>
            <li>Your orders, including the name, email and phone you typed when you ordered online.</li>
          </ul>

          <h2>What the counter sees</h2>
          <p>
            When you show your code, the till sees only the code, how many stamps you have, and whether your card is digital
            or paper. It does not see your name, email, phone or points.
          </p>

          <h2>Age</h2>
          <p>You must be 13 or older to have a Kennko card.</p>

          <h2>Deleting your account</h2>
          <p>
            Sign in, open your account and choose Delete account. We remove your sign-in, your card, stamps and points, and
            the link between you and your orders. Past orders stay in the shop&apos;s sales records without your account attached.
          </p>

          <h2>Contact</h2>
          <p>Ask at the counter, or message us through the Kennko page on Facebook or Instagram.</p>

          <p className="account-guest">Privacy notice version {PRIVACY_VERSION}</p>
        </div>
      </div>
    </div>
  )
}
