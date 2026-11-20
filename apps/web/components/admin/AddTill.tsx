'use client'

import { useEffect, useState, useTransition } from 'react'
import { addTill } from '@/app/admin/devices/actions'
import { formatCountdown, secondsLeft, spacedCode } from '@/lib/admin/tills'

type Issued = { code: string; expiresAt: string }

function Code({ issued }: { issued: Issued }) {
  const [left, setLeft] = useState(() => secondsLeft(issued.expiresAt, Date.now()))

  useEffect(() => {
    const timer = setInterval(() => setLeft(secondsLeft(issued.expiresAt, Date.now())), 1000)
    return () => clearInterval(timer)
  }, [issued.expiresAt])

  if (left <= 0) {
    return (
      <p className="admin-error" role="status">
        This code has expired. Add the till again.
      </p>
    )
  }

  return (
    <div className="till-code-box">
      <strong className="till-code" aria-label={`Pairing code ${issued.code.split('').join(' ')}`}>
        {spacedCode(issued.code)}
      </strong>
      <p className={left < 60 ? 'till-countdown is-low' : 'till-countdown'}>Valid for {formatCountdown(left)}</p>
      <p>
        On the till, open <strong>Menu › Connect this till</strong> and type this code.
      </p>
    </div>
  )
}

export function AddTill() {
  const [name, setName] = useState('Counter till')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<Issued | null>(null)

  return (
    <form
      className="section-card"
      onSubmit={(event) => {
        event.preventDefault()
        startTransition(async () => {
          setError(null)
          const result = await addTill(name)
          if (result.ok) setIssued({ code: result.code, expiresAt: result.expiresAt })
          else setError(result.message)
        })
      }}
    >
      <h2>Add a till</h2>
      <label className="admin-field">
        <span>Name</span>
        <input value={name} maxLength={40} required onChange={(event) => setName(event.target.value)} />
      </label>
      {error ? (
        <p className="admin-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="btn btn-primary" type="submit" disabled={pending}>
        Add till
      </button>
      {issued ? <Code key={issued.code + issued.expiresAt} issued={issued} /> : null}
    </form>
  )
}
