'use client'

import { useState, useTransition } from 'react'
import { publishMenuNow } from '@/app/admin/menu/actions'

export function PublishMenuButton() {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await publishMenuNow()
            setMessage(
              result.ok
                ? `Menu published (version ${result.version}).`
                : `Could not publish the menu: ${result.message}`,
            )
          })
        }
      >
        {pending ? 'Publishing…' : 'Publish menu'}
      </button>
      {message ? (
        <p className="admin-notice" role="status">
          {message}
        </p>
      ) : null}
    </>
  )
}
