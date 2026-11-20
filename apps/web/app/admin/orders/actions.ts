'use server'

import { revalidatePath } from 'next/cache'
import type { PaymentNotice, PrepStatus } from '@kennko/core'
import { requireStaff } from '@/lib/auth/session'
import { staffFetch } from '@/lib/api/client'
import { sendEmail } from '@/lib/email/send'
import { buildReceipt } from '@/lib/receipts/receipt'
import { loadReceipt } from '@/lib/receipts/load'
import { receiptHtml, receiptText, escapeHtml } from '@/lib/receipts/email'
import { formatManilaDateTime } from '@/lib/format/time'
import {
  customerConfirmSubject, customerConfirmBody,
  customerRejectSubject, customerRejectBody,
  type OrderEmailData,
} from '@/lib/email/templates'

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

type Mail = { data: OrderEmailData; to: string; reference: string | null }

/**
 * What the customer emails need, from the staff-only `GET /v1/payments/:id/notice`: the full name,
 * street address and GCash reference, which only the customer's own inbox may see. 404 (no such
 * payment, or a counter order with no email) is null: no email. Other failures throw, and the caller
 * logs them without failing the payment action.
 */
async function emailFor(paymentId: string): Promise<Mail | null> {
  const res = await staffFetch(`/v1/payments/${encodeURIComponent(paymentId)}/notice`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Payment notice failed (${res.status})`)
  const n = (await res.json()) as PaymentNotice
  return {
    to: n.to,
    reference: n.reference,
    data: {
      orderCode: n.orderCode,
      ticket: n.ticket,
      customerName: n.customerName,
      fulfilment: n.fulfilment,
      fulfilAt: n.fulfilAt ? formatManilaDateTime(n.fulfilAt) : '',
      totalCentavos: n.totalCentavos,
      deliveryAddress: n.deliveryAddress,
      items: n.items.map((i) => ({ name: i.name, variantLabel: i.variantLabel, quantity: i.quantity })),
    },
  }
}

type EmailContent = { subject: string; text: string; html?: string }

function whenWhere(d: OrderEmailData, shopAddress: string): string {
  return d.fulfilment === 'delivery'
    ? `Delivery on ${d.fulfilAt} to ${d.deliveryAddress}`
    : `Pickup on ${d.fulfilAt} at ${shopAddress}`
}

/**
 * Today's confirmation, plus the e-receipt when it can be built. A receipt problem of any kind
 * (load error, unverified payment) falls back to the plain confirmation, never blocks it.
 * The receipt is the public one with the notice's full name, street address and reference put back.
 */
async function confirmationWithReceipt(mail: Mail): Promise<EmailContent> {
  const d = mail.data
  const plain = { subject: customerConfirmSubject(d), text: customerConfirmBody(d) }
  try {
    const loaded = await loadReceipt(d.orderCode)
    if (!loaded) return plain
    const { settings } = loaded
    const order = {
      ...loaded.order,
      customerName: d.customerName,
      deliveryAddress: d.deliveryAddress ?? null,
      reference: mail.reference,
    }
    const receipt = buildReceipt(order, settings, 'email')
    if (!receipt) return plain
    const base = (process.env.NEXT_PUBLIC_SITE_URL || 'https://kennko.vercel.app').replace(/\/+$/, '')
    const link = `${base}/order/${encodeURIComponent(d.orderCode)}/receipt`
    return {
      subject: plain.subject,
      text: `${plain.text}\n\n${receiptText(receipt)}\n\nView or print your receipt: ${link}`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111111;">
<p>Hi ${escapeHtml(d.customerName)},</p>
<p>We checked your GCash payment and your order ${escapeHtml(d.orderCode)} is confirmed. Thanks for ordering from Kennko Coffee.</p>
<p>${escapeHtml(whenWhere(d, settings.address))}</p>
${receiptHtml(receipt)}
<p>View or print your receipt: <a href="${escapeHtml(link)}" style="color:#0055FF;">${escapeHtml(link)}</a></p>
</div>`,
    }
  } catch (cause) {
    console.error('Receipt for the confirmation email failed; sending without it', cause)
    return plain
  }
}

/**
 * The API call already succeeded; a mail problem must never turn that into an error for staff.
 * The send is awaited (it never throws): it is the customer's only confirmation, and a serverless
 * function may be frozen as soon as the action returns.
 */
async function notifyCustomer(
  paymentId: string,
  compose: (mail: Mail) => EmailContent | Promise<EmailContent>,
) {
  try {
    const mail = await emailFor(paymentId)
    if (mail) await sendEmail({ to: [mail.to], ...(await compose(mail)) })
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
  await notifyCustomer(paymentId, confirmationWithReceipt)
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

  await notifyCustomer(paymentId, ({ data }) => ({
    subject: customerRejectSubject(data), text: customerRejectBody(data, why),
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

/** A 300-second signed link to the payment's receipt image, from the API. The bucket is private; staff never get a raw path. */
export async function proofUrl(paymentId: string): Promise<string | null> {
  await requireStaff()
  try {
    const res = await staffFetch(`/v1/payments/${encodeURIComponent(paymentId)}/proof`)
    if (!res.ok) return null
    const { url } = (await res.json()) as { url?: unknown }
    return typeof url === 'string' ? url : null
  } catch {
    return null
  }
}
