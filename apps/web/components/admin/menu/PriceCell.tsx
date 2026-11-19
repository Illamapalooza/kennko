'use client'

import { useEffect, useRef, useState } from 'react'
import { updateVariantPrice } from '@/app/admin/menu/actions'
import { formatPesos } from '@/lib/money'
import { clearDirty, markDirty } from '@/lib/admin/dirty'
import type { VariantCode } from '@/lib/menu/types'

type Props = {
  itemId: string
  itemName: string
  code: VariantCode
  label: string
  initialCentavos: number | null
  editable: boolean
  soldOut?: boolean
}

function toInput(centavos: number | null): string {
  return centavos === null ? '' : (centavos / 100).toFixed(2)
}

export function PriceCell({ itemId, itemName, code, label, initialCentavos, editable, soldOut = false }: Props) {
  const [value, setValue] = useState(toInput(initialCentavos))
  const [savedText, setSavedText] = useState(toInput(initialCentavos))
  const valueRef = useRef(value)
  const savedRef = useRef(savedText)
  const inFlight = useRef(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const dirty = value !== savedText
  const warn = status === 'saving' || (status === 'error' && dirty)
  const busy = dirty || status === 'saving'
  const dirtyId = `price:${itemId}:${code}`

  // Holds off the admin's background refresh while this cell has unsaved text or a save in flight.
  useEffect(() => {
    if (!busy) return
    markDirty(dirtyId)
    return () => clearDirty(dirtyId)
  }, [busy, dirtyId])

  // A refresh can bring a new price (another device, a publish). Show it, but
  // only when the cell is idle: never over a save in flight or unsaved text.
  useEffect(() => {
    const next = toInput(initialCentavos)
    if (inFlight.current || valueRef.current !== savedRef.current || next === savedRef.current) return
    savedRef.current = next
    valueRef.current = next
    setSavedText(next)
    setValue(next)
  }, [initialCentavos])

  useEffect(() => {
    if (!warn) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [warn])

  async function save() {
    if (inFlight.current || valueRef.current === savedRef.current) return
    inFlight.current = true
    setStatus('saving')
    try {
      // Text typed while a save is in flight is sent next, never overwritten.
      while (valueRef.current !== savedRef.current) {
        const sent = valueRef.current
        let result: Awaited<ReturnType<typeof updateVariantPrice>>
        try {
          result = await updateVariantPrice(itemId, code, sent)
        } catch {
          setMessage('Could not save. Try again.')
          setStatus('error')
          return
        }
        if (!result.ok) {
          setMessage(result.message)
          setStatus('error')
          return
        }
        savedRef.current = toInput(result.priceCentavos)
        setSavedText(savedRef.current)
        if (valueRef.current === sent) {
          valueRef.current = savedRef.current
          setValue(savedRef.current)
        }
      }
      setStatus('saved')
    } finally {
      inFlight.current = false
    }
  }

  const inputLabel = label === 'Single price' ? `${itemName} single price` : `${itemName} ${label} price`

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
            aria-label={inputLabel}
            onChange={(e) => {
              valueRef.current = e.target.value
              setValue(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void save()
              }
            }}
            onBlur={() => void save()}
          />
        ) : (
          <span className="price-cell-value">
            {savedText === '' ? 'Not offered' : formatPesos(Math.round(Number(savedText) * 100))}
          </span>
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
