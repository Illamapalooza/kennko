'use client'

import { useActionState } from 'react'
import { signIn, type LoginState } from './actions'

const initialState: LoginState = { error: null }

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, initialState)

  return (
    <main className="admin-auth">
      <form className="admin-auth-card" action={formAction}>
        <h1>Kennko Admin</h1>
        <p className="admin-auth-sub">Sign in to manage orders and the menu.</p>

        <label className="admin-field">
          <span>Email</span>
          <input name="email" type="email" autoComplete="username" required />
        </label>

        <label className="admin-field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>

        {state.error ? (
          <p className="admin-error" role="alert">
            {state.error}
          </p>
        ) : null}

        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
