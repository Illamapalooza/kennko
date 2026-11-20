'use client'

import { useState } from 'react'
import { getBrowserClient } from '@/lib/supabase/client'

type State = 'idle' | 'sending' | 'sent' | 'error'

/** A deliberately loose check: one @, something either side, a dot in the domain. Supabase does the real one. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function EmailSignIn({ next = '/account' }: { next?: string }) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<State>('idle')
  const [invalid, setInvalid] = useState(false)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!looksLikeEmail(email)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setState('sending')
    const { error } = await getBrowserClient().auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        shouldCreateUser: true,
      },
    })
    setState(error ? 'error' : 'sent')
  }

  if (state === 'sent') {
    return (
      <p className="account-note" role="status">
        Check your email for a sign-in link. Open it on this phone or computer.
      </p>
    )
  }

  return (
    <form className="email-signin" onSubmit={send} noValidate>
      <label htmlFor="signin-email">Email address</label>
      <input
        id="signin-email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-invalid={invalid}
      />
      {invalid ? <p className="order-error" role="alert">Enter a valid email address.</p> : null}
      <button type="submit" className="sheet-add" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
      </button>
      {state === 'error' ? (
        <p className="order-error" role="alert">We couldn&apos;t send the link. Try again in a minute.</p>
      ) : null}
    </form>
  )
}
