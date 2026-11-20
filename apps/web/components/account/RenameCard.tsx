'use client'

import { useState, useTransition } from 'react'
import { renameCard } from '@/app/account/actions'

export function RenameCard({ name }: { name: string }) {
  const [value, setValue] = useState(name)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    start(async () => {
      const result = await renameCard(value)
      setMessage(result.ok ? 'Saved.' : result.message)
    })
  }

  return (
    <form className="rename-form" onSubmit={submit}>
      <label htmlFor="card-name">Name on your card</label>
      <div className="rename-row">
        <input id="card-name" value={value} maxLength={40} onChange={(e) => setValue(e.target.value)} />
        <button type="submit" className="quiet-btn" disabled={pending || value.trim() === name}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {message ? <p className="account-note" role="status">{message}</p> : null}
    </form>
  )
}
