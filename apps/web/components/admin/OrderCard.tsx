'use client'

import { useState, useTransition } from 'react'
import { formatPesos } from '@/lib/money'
import { formatManilaDateTime } from '@/lib/format/time'
import type { OrderStage, PaymentStatus, PrepStatus } from '@kennko/core'
import { confirmPayment, rejectPayment, advanceStatus, cancelOrder, proofUrl } from '@/app/admin/orders/actions'
import { nextStatus, prepLabel, statusLabel, type Fulfilment } from '@/app/admin/orders/status'

export type AdminOrder = {
  id: string
  orderCode: string
  ticket: string
  createdAt: string
  prepStatus: PrepStatus
  paymentStatus: PaymentStatus
  stage: OrderStage
  fulfilment: Fulfilment
  customerName: string
  customerPhone: string
  customerEmail: string
  deliveryAddress: string | null
  deliveryBarangay: string | null
  deliveryLat: number | null
  deliveryLng: number | null
  deliveryDistanceKm: number | null
  fulfilAt: string
  subtotalCentavos: number
  deliveryFeeCentavos: number
  totalCentavos: number
  paymentId: string | null
  gcashReference: string | null
  proofPath: string | null
  customerNote: string | null
  cancelReason: string | null
  items: {
    name: string; variantLabel: string; quantity: number
    modifiers: string[]; ice: string | null; note: string | null
  }[]
}

export function OrderCard({
  order,
  isDuplicateReference,
  isOwner,
}: {
  order: AdminOrder
  isDuplicateReference: boolean
  isOwner: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [proof, setProof] = useState<string | null>(null)

  const run = (fn: () => Promise<{ ok: true } | { ok: false; message: string } | void>) =>
    startTransition(async () => {
      setError(null)
      try {
        const result = await fn()
        if (result && !result.ok) setError(result.message)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Something went wrong')
      }
    })

  const advance = nextStatus(order)
  const unverified = order.stage === 'awaiting_verification'
  const canCancel = isOwner && order.prepStatus !== 'completed' && order.prepStatus !== 'cancelled'

  const askCancel = () => {
    const why = window.prompt('Why is this order being cancelled?')
    if (!why || !why.trim()) return
    if (!window.confirm(`Cancel order ${order.ticket}? This cannot be undone.`)) return
    run(() => cancelOrder(order.id, why))
  }

  return (
    <article className="section-card" style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <strong>{order.ticket} · {order.orderCode}</strong>
        <span>{statusLabel(order.stage)}</span>
      </div>

      <div>
        <strong>{order.fulfilment === 'delivery' ? 'DELIVERY' : 'PICKUP'}</strong>
        {order.fulfilment === 'delivery' ? (
          <>
            <p style={{ margin: '4px 0' }}>
              {order.deliveryAddress}, {order.deliveryBarangay}
            </p>
            {order.deliveryLat !== null && order.deliveryLng !== null ? (
              <p style={{ margin: '4px 0' }}>
                <a
                  className="btn btn-secondary"
                  href={`https://www.google.com/maps/dir/?api=1&destination=${order.deliveryLat},${order.deliveryLng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Navigate to pin
                </a>
                {order.deliveryDistanceKm !== null ? (
                  <span> · {order.deliveryDistanceKm}km</span>
                ) : null}
              </p>
            ) : (
              <p className="admin-notice" style={{ margin: '4px 0' }}>
                No pin shared — call the customer for directions.
              </p>
            )}
          </>
        ) : null}
        <p style={{ margin: '4px 0' }}>{formatManilaDateTime(order.fulfilAt)}</p>
      </div>

      <div>
        {order.items.map((item, i) => (
          <div key={`${item.name}-${i}`}>
            {item.quantity}× {item.name} ({item.variantLabel})
            {item.modifiers.length > 0 ? ` + ${item.modifiers.join(', ')}` : ''}
            {item.ice ? <strong className="order-ice"> · {item.ice}</strong> : null}
            {item.note ? (
              <div className="order-item-note">“{item.note}”</div>
            ) : null}
          </div>
        ))}
      </div>

      {order.customerNote ? <p><em>Note: {order.customerNote}</em></p> : null}
      {order.cancelReason ? <p><strong>Cancelled:</strong> {order.cancelReason}</p> : null}

      <div>
        <div>Subtotal {formatPesos(order.subtotalCentavos)}</div>
        {order.deliveryFeeCentavos > 0 ? (
          <div>Delivery {formatPesos(order.deliveryFeeCentavos)}</div>
        ) : null}
        <strong>Total {formatPesos(order.totalCentavos)}</strong>
      </div>

      <div>
        <div>{order.customerName} · {order.customerPhone}</div>
        <div>{order.customerEmail}</div>
      </div>

      <div>
        <strong>GCash ref: {order.gcashReference ?? 'none'}</strong>
        {isDuplicateReference ? (
          <p className="admin-error" role="alert">
            This reference is already used by another live order. Check both
            before confirming — one receipt cannot pay for two orders.
          </p>
        ) : null}
      </div>

      {order.proofPath === null || order.paymentId === null ? null : proof ? (
        <a href={proof} target="_blank" rel="noreferrer">
          <img src={proof} alt="GCash receipt" style={{ maxWidth: '100%', borderRadius: 12 }} />
        </a>
      ) : (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          onClick={() => run(async () => setProof(await proofUrl(order.paymentId as string)))}
        >
          View receipt
        </button>
      )}

      {unverified ? (
        <p className="admin-notice">
          Check this reference in the GCash app before confirming. Nothing here
          proves the money arrived.
        </p>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {unverified && order.paymentId ? (
          <>
            <button
              type="button" className="btn btn-primary" disabled={pending}
              onClick={() => run(() => confirmPayment(order.paymentId as string))}
            >
              Confirm payment
            </button>
            <button
              type="button" className="btn btn-secondary" disabled={pending}
              onClick={() => setShowReject((v) => !v)}
            >
              Reject
            </button>
          </>
        ) : null}

        {advance ? (
          <button
            type="button" className="btn btn-primary" disabled={pending}
            onClick={() => run(() => advanceStatus(order.id, advance))}
          >
            Mark {prepLabel(advance).toLowerCase()}
          </button>
        ) : null}

        {canCancel ? (
          <button
            type="button" className="btn btn-secondary" disabled={pending}
            onClick={askCancel}
          >
            Cancel order
          </button>
        ) : null}
      </div>

      {showReject && order.paymentId ? (
        <div>
          <label className="admin-field">
            <span>Why? The customer sees this.</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button
            type="button" className="btn btn-primary" disabled={pending || !reason.trim()}
            onClick={() => run(() => rejectPayment(order.paymentId as string, reason))}
          >
            Send rejection
          </button>
        </div>
      ) : null}

      {error ? <p className="admin-error" role="alert">{error}</p> : null}
    </article>
  )
}
