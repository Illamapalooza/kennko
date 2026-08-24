'use client'

import { useState, useTransition } from 'react'
import { uploadMenuImage, removeMenuImage } from '@/app/admin/menu/actions'

export function ImageUploadField({
  itemId,
  currentUrl,
}: {
  itemId: string
  currentUrl: string | null
}) {
  const [preview, setPreview] = useState<string | null>(currentUrl)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <div className="admin-field">
      <span>Product photo</span>

      {preview ? (
        <img src={preview} alt="" style={{ maxWidth: '220px', borderRadius: '16px' }} />
      ) : (
        <p>No photo yet.</p>
      )}

      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        disabled={pending}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) return
          setError(null)
          setPreview(URL.createObjectURL(file))
          startTransition(async () => {
            try {
              await uploadMenuImage(itemId, file)
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Upload failed')
              setPreview(currentUrl)
            }
          })
        }}
      />

      {preview ? (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await removeMenuImage(itemId)
              setPreview(null)
            })
          }
        >
          Remove photo
        </button>
      ) : null}

      {error ? (
        <p className="admin-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
