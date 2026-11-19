'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { publishMenuNow } from '@/app/admin/menu/actions'

export function PublishMenuButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  return (
    <>
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await publishMenuNow()
            setMessage(result.ok ? null : `Could not publish the menu: ${result.message}`)
            if (result.ok) router.refresh()
          })
        }
      >
        {pending ? 'Publishing…' : 'Publish'}
      </button>
      {message ? (
        <p className="admin-notice" role="alert">
          {message}
        </p>
      ) : null}
    </>
  )
}
