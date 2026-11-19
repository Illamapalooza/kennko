'use client'

import { useEffect, useRef, useState } from 'react'
import { updateVariantPrice } from '@/app/admin/menu/actions'
import type { VariantCode } from '@/lib/menu/types'

type Props = {
  itemId: string
  code: VariantCode
  label: string
  initialCentavos: number | null
  editable: boolean
  soldOut?: boolean
}

function toInput(centavos: number | null): string {
  return centavos === null ? '' : (centavos / 100).toFixed(2)
}

export function PriceCell({ itemId, code, label, initialCentavos, editable, soldOut = false }: Props) {
  const [value, setValue] = useState(toInput(initialCentavos))
  const saved = useRef(toInput(initialCentavos))
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (status !== 'saving') return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [status])

  async function save() {
    if (value === saved.current || status === 'saving') return
    setStatus('saving')
    const result = await updateVariantPrice(itemId, code, value)
    if (result.ok) {
      saved.current = toInput(result.priceCentavos)
      setValue(saved.current)
      setStatus('saved')
    } else {
      setMessage(result.message)
      setStatus('error')
    }
  }

  const display = value === '' ? 'Not offered' : `₱${value}`

  return (
    <div className="price-cell">
      <label className="price-cell-label">
        <span>{label}</span>
        {soldOut ? <span className="price-cell-sold">Sold out</span> : null}
        {editable ? (
          <input
            inputMode="decimal"
            value={value}
            placeholder="—"
            aria-label={`${label} price`}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void save()
              }
            }}
            onBlur={() => void save()}
          />
        ) : (
          <span className="price-cell-value">{display}</span>
        )}
      </label>
      {status === 'saving' ? <small>Saving…</small> : null}
      {status === 'saved' ? <small>Saved</small> : null}
      {status === 'error' ? (
        <small role="alert" className="price-cell-error">
          {message}
        </small>
      ) : null}
    </div>
  )
}
