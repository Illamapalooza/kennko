'use server'

import { revalidatePath } from 'next/cache'
import type { PrepStatus } from '@kennko/core'
import { getAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/auth/session'
import { staffFetch } from '@/lib/api/client'
import { sendEmail } from '@/lib/email/send'
import { iceSummary, type IceLevel, type IceServe } from '@/lib/cart/ice'
import {
  customerConfirmSubject, customerConfirmBody,
  customerRejectSubject, customerRejectBody,
  type OrderEmailData,
} from '@/lib/email/templates'

const PROOF_BUCKET = 'payment-proofs'

type Result = { ok: true } | { ok: false; message: string }

const CHANGED = 'This order changed on another screen. Refresh to see it.'
const OWNER_ONLY = 'Only the owner can cancel orders.'
const UNREACHABLE = "Couldn't reach the server. Try again."

/** Every order write goes through the API; this maps its answer to a message staff can act on. */
async function callApi(path: string, init: { method: string; body?: unknown }): Promise<Result> {
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
  if (res.status === 409) return { ok: false, message: CHANGED }
  if (res.status === 403) return { ok: false, message: OWNER_ONLY }
  if (res.status === 401) return { ok: false, message: 'Your session ended. Sign in again.' }
  if (res.status === 404) return { ok: false, message: 'That order no longer exists. Refresh to see it.' }
  const body = (await res.json().catch(() => null)) as { message?: string } | null
  return { ok: false, message: body?.message ?? 'Something went wrong. Try again.' }
}

type OrderRow = {
  order_code: string; ticket_series: 'C' | 'W'; ticket_number: number
  customer_name: string; customer_email: string | null; fulfilment: 'pickup' | 'delivery'
  fulfil_at: string | null; total_centavos: number; delivery_address: string | null
  order_lines: {
    item_name: string; variant_label: string; quantity: number
    ice_level: string | null; ice_serve: string | null; note: string | null
  }[]
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
       order_lines ( item_name, variant_label, quantity, ice_level, ice_serve, note )`,
    )
    .eq('id', payment.order_id)
    .maybeSingle()
  const row = data as OrderRow | null
  if (!row || !row.customer_email) return null

  return {
    to: row.customer_email,
    data: {
      orderCode: row.order_code,
      customerName: row.customer_name,
      fulfilment: row.fulfilment,
      fulfilAt: row.fulfil_at ? new Date(row.fulfil_at).toLocaleString('en-PH') : '',
      totalCentavos: row.total_centavos,
      deliveryAddress: row.delivery_address,
      items: (row.order_lines ?? []).map((l) => ({
        name: l.item_name,
        variantLabel: l.variant_label,
        quantity: l.quantity,
        ice: iceSummary(l.ice_level as IceLevel | null, l.ice_serve as IceServe | null),
        note: l.note,
      })),
    },
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
  const mail = await emailFor(paymentId)
  if (mail) {
    void sendEmail({
      to: [mail.to],
      subject: customerConfirmSubject(mail.data),
      text: customerConfirmBody(mail.data),
    })
  }
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

  const mail = await emailFor(paymentId)
  if (mail) {
    void sendEmail({
      to: [mail.to],
      subject: customerRejectSubject(mail.data),
      text: customerRejectBody(mail.data, why),
    })
  }
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
  const result = await callApi(`/v1/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST', body: { reason: why },
  })
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
