'use server'

import { revalidatePath } from 'next/cache'
import { ticketLabel, type PrepStatus } from '@kennko/core'
import { getAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/auth/session'
import { staffFetch } from '@/lib/api/client'
import { sendEmail } from '@/lib/email/send'
import { formatManilaDateTime } from '@/lib/format/time'
import {
  customerConfirmSubject, customerConfirmBody,
  customerRejectSubject, customerRejectBody,
  type OrderEmailData,
} from '@/lib/email/templates'

const PROOF_BUCKET = 'payment-proofs'

type Result = { ok: true } | { ok: false; message: string }

const UNREACHABLE = "Couldn't reach the server. Try again."

/**
 * Every order write goes through the API; this maps its answer to a message staff can act on.
 * Never the raw API message: it is written for developers, not for the counter.
 */
async function callApi(
  path: string,
  init: { method: string; body?: unknown },
  forbidden = "Your account can't do that. Ask the owner.",
): Promise<Result> {
  let res: Response
  try {
    res = await staffFetch(path, {
      method: init.method,
      ...(init.body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
    })
  } catch {
    return { ok: false, message: UNREACHABLE }
  }
  if (res.ok) return { ok: true }
  const body = (await res.json().catch(() => null)) as { code?: unknown } | null
  const code = typeof body?.code === 'string' ? body.code : null
  if (code === 'STATUS_CHANGED') return { ok: false, message: 'This order changed on another screen. Refresh to see it.' }
  if (code === 'BAD_TRANSITION') {
    return { ok: false, message: "That step isn't allowed for this order. Refresh to see where it is." }
  }
  if (code === 'FORBIDDEN' || res.status === 403) return { ok: false, message: forbidden }
  if (res.status === 401) return { ok: false, message: 'Your session ended. Sign in again.' }
  if (res.status === 404) return { ok: false, message: 'This order no longer exists.' }
  return { ok: false, message: 'Something went wrong. Try again.' }
}

type OrderRow = {
  order_code: string; ticket_series: 'C' | 'W'; ticket_number: number
  customer_name: string; customer_email: string | null; fulfilment: 'pickup' | 'delivery'
  fulfil_at: string | null; total_centavos: number; delivery_address: string | null
  order_lines: { item_name: string; variant_label: string; quantity: number }[]
}

async function emailFor(paymentId: string): Promise<{ data: OrderEmailData; to: string } | null> {
  const db = getAdminClient()
  const { data: payment } = await db.from('payments').select('order_id').eq('id', paymentId).maybeSingle()
  if (!payment) return null

  const { data } = await db
    .from('orders')
    .select(
      `order_code, ticket_series, ticket_number, customer_name, customer_email, fulfilment, fulfil_at,
       total_centavos, delivery_address,
       order_lines ( item_name, variant_label, quantity )`,
    )
    .eq('id', payment.order_id)
    .maybeSingle()
  const row = data as OrderRow | null
  if (!row || !row.customer_email) return null

  return {
    to: row.customer_email,
    data: {
      orderCode: row.order_code,
      ticket: ticketLabel(row.ticket_series, row.ticket_number),
      customerName: row.customer_name,
      fulfilment: row.fulfilment,
      fulfilAt: row.fulfil_at ? formatManilaDateTime(row.fulfil_at) : '',
      totalCentavos: row.total_centavos,
      deliveryAddress: row.delivery_address,
      items: (row.order_lines ?? []).map((l) => ({
        name: l.item_name,
        variantLabel: l.variant_label,
        quantity: l.quantity,
      })),
    },
  }
}

/**
 * The API call already succeeded; a mail problem must never turn that into an error for staff.
 * The send is awaited (it never throws): it is the customer's only confirmation, and a serverless
 * function may be frozen as soon as the action returns.
 */
async function notifyCustomer(
  paymentId: string,
  compose: (data: OrderEmailData) => { subject: string; text: string },
) {
  try {
    const mail = await emailFor(paymentId)
    if (mail) await sendEmail({ to: [mail.to], ...compose(mail.data) })
  } catch (cause) {
    console.error('Customer email failed after the payment action succeeded', cause)
  }
}

function refresh() {
  revalidatePath('/admin/orders')
  revalidatePath('/admin', 'layout')
}

export async function confirmPayment(paymentId: string): Promise<Result> {
  await requireStaff()
  const result = await callApi(`/v1/payments/${encodeURIComponent(paymentId)}/verify`, { method: 'POST' })
  if (!result.ok) return result

  // Only now does the customer hear anything -- the whole point of the verification gate.
  await notifyCustomer(paymentId, (d) => ({
    subject: customerConfirmSubject(d), text: customerConfirmBody(d),
  }))
  refresh()
  return result
}

export async function rejectPayment(paymentId: string, reason: string): Promise<Result> {
  await requireStaff()
  const why = reason.trim()
  if (!why) return { ok: false, message: 'Give a reason so the customer knows what happened' }

  const result = await callApi(`/v1/payments/${encodeURIComponent(paymentId)}/reject`, {
    method: 'POST', body: { reason: why },
  })
  if (!result.ok) return result

  await notifyCustomer(paymentId, (d) => ({
    subject: customerRejectSubject(d), text: customerRejectBody(d, why),
  }))
  refresh()
  return result
}

export async function advanceStatus(orderId: string, to: PrepStatus): Promise<Result> {
  await requireStaff()
  const result = await callApi(`/v1/orders/${encodeURIComponent(orderId)}`, {
    method: 'PATCH', body: { prepStatus: to },
  })
  if (result.ok) refresh()
  return result
}

export async function cancelOrder(orderId: string, reason: string): Promise<Result> {
  await requireStaff()
  const why = reason.trim()
  if (!why) return { ok: false, message: 'Give a reason for cancelling.' }
  const result = await callApi(
    `/v1/orders/${encodeURIComponent(orderId)}/cancel`,
    { method: 'POST', body: { reason: why } },
    'Only the owner can cancel orders.',
  )
  if (result.ok) refresh()
  return result
}

/** Short-lived signed URL. The bucket is private; staff never get a raw path. */
export async function proofUrl(path: string): Promise<string | null> {
  await requireStaff()
  const { data } = await getAdminClient()
    .storage.from(PROOF_BUCKET)
    .createSignedUrl(path, 300)
  return data?.signedUrl ?? null
}
