'use client'

import { useActionState } from 'react'
import { setPassword, type PasswordState } from './actions'

const initialState: PasswordState = { error: null, done: false }

export default function PasswordPage() {
  const [state, formAction, pending] = useActionState(setPassword, initialState)

  return (
    <section>
      <h1>Set a password</h1>
      <p>
        After this you can sign in at the admin sign-in page with your email and this password, as well as with
        Google.
      </p>

      {state.done ? (
        <p role="status">Your password is set. Use it with your email next time you sign in.</p>
      ) : (
        <form className="admin-auth-card" action={formAction}>
          <label className="admin-field">
            <span>New password</span>
            <input name="password" type="password" autoComplete="new-password" minLength={8} required />
          </label>
          <label className="admin-field">
            <span>Type it again</span>
            <input name="confirm" type="password" autoComplete="new-password" minLength={8} required />
          </label>
          {state.error ? (
            <p className="admin-error" role="alert">
              {state.error}
            </p>
          ) : null}
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Set password'}
          </button>
        </form>
      )}
    </section>
  )
}
