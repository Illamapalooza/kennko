'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import type { CatLook } from '@kennko/core'
import { checkIn } from '@/app/here/actions'
import { checkinMessage, type CheckinResult } from '@/app/here/here'
import { catLabel } from '@/app/account/cat'
import { CatCanvas } from '@/components/account/CatCanvas'

/** The cat and one button. The visit starts only when the customer taps it, never on page load. */
export function HereCheckin({ code, name, look }: { code: string; name: string; look: CatLook }) {
  const [result, setResult] = useState<CheckinResult | null>(null)
  const [pending, start] = useTransition()
  const message = result ? checkinMessage(result, name, code) : null
  const done = result?.status === 'ok'

  return (
    <>
      <div className="cat-stage here-stage">
        <CatCanvas look={look} label={catLabel(name, look, {})} scale={10} />
      </div>
      {!done ? (
        <button
          type="button"
          className="btn btn-primary here-go"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setResult(null)
              setResult(await checkIn(code))
            })
          }
        >
          {pending ? 'Walking in…' : 'Walk my cat in'}
        </button>
      ) : null}
      {message ? (
        <div className={message.tone === 'good' ? 'account-note here-msg' : 'order-error here-msg'} role={message.tone === 'good' ? 'status' : 'alert'}>
          <p className="here-title">{message.title}</p>
          {message.detail ? <p>{message.detail}</p> : null}
          {message.link ? <p><Link href={message.link.href}>{message.link.label}</Link></p> : null}
        </div>
      ) : null}
    </>
  )
}
