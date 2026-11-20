'use client'

import { useState, useTransition } from 'react'
import { deleteAccount } from '@/app/account/actions'

/** Deleting is explicit: say what goes, then type DELETE. `hasCard` only changes the wording. */
export function DeleteAccount({ hasCard }: { hasCard: boolean }) {
  const [typed, setTyped] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const label = hasCard ? 'Delete account' : 'Delete my sign-in'

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    start(async () => {
      // On success the action redirects, so a result only comes back when something went wrong.
      const result = await deleteAccount(typed)
      if (result && !result.ok) setMessage(result.message)
    })
  }

  return (
    <details className="delete-account">
      <summary>{label}</summary>
      <form onSubmit={submit}>
        <p>This cannot be undone. Deleting removes:</p>
        <ul>
          <li>your sign-in, so you can no longer log in with it;</li>
          {hasCard ? (
            <>
              <li>your Kennko card and its code;</li>
              <li>your stamps, including any free drink waiting;</li>
              <li>your points;</li>
            </>
          ) : null}
          <li>the link between you and your past orders (the orders themselves stay as shop records).</li>
        </ul>
        <label htmlFor="delete-confirm">Type DELETE to confirm</label>
        <input
          id="delete-confirm"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        {message ? <p className="order-error" role="alert">{message}</p> : null}
        <button type="submit" className="danger-btn" disabled={pending || typed !== 'DELETE'}>
          {pending ? 'Deleting…' : label}
        </button>
      </form>
    </details>
  )
}
