'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { joinKennko } from '@/app/account/actions'

export function JoinForm() {
  const [message, setMessage] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setMessage(null)
    start(async () => {
      const result = await joinKennko(form)
      if (!result.ok) setMessage(result.message)
    })
  }

  return (
    <form className="join-form" onSubmit={submit}>
      <label className="check-row">
        <input type="checkbox" name="age" />
        <span>I am 13 or older.</span>
      </label>
      <label className="check-row">
        <input type="checkbox" name="privacy" />
        <span>
          I have read the <Link href="/privacy">privacy notice</Link> and I accept it.
        </span>
      </label>
      {message ? <p className="order-error" role="alert">{message}</p> : null}
      <button type="submit" className="sheet-add" disabled={pending}>
        {pending ? 'Making your card…' : 'Get my Kennko card'}
      </button>
    </form>
  )
}
