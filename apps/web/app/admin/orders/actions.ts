'use server'

import { revalidatePath } from 'next/cache'
import { getServerClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/auth/session'
import { sendEmail } from '@/lib/email/send'
import {
  customerConfirmSubject, customerConfirmBody,
  customerRejectSubject, customerRejectBody,
  type OrderEmailData,
} from '@/lib/email/templates'
import type { OrderStatus } from './status'

const PROOF_BUCKET = 'payment-proofs'

async function emailDataFor(orderId: string): Promise<OrderEmailData | null> {
  const { data } = await getAdminClient()
    .from('orders')
    .select(
      'order_code, customer_name, fulfilment, fulfil_at, total_centavos, delivery_address, order_items ( name_snapshot, size, quantity )',
    )
    .eq('id', orderId)
    .maybeSingle()

  if (!data) return null

  return {
    orderCode: data.order_code,
    customerName: data.customer_name,
    fulfilment: data.fulfilment,
    fulfilAt: new Date(data.fulfil_at).toLocaleString('en-PH'),
    totalCentavos: data.total_centavos,
    deliveryAddress: data.delivery_address,
    items: (data.order_items ?? []).map(
      (i: { name_snapshot: string; size: string; quantity: number }) => ({
        name: i.name_snapshot, size: i.size, quantity: i.quantity,
      }),
    ),
  }
}

async function customerEmail(orderId: string): Promise<string | null> {
  const { data } = await getAdminClient()
    .from('orders').select('customer_email').eq('id', orderId).maybeSingle()
  return data?.customer_email ?? null
}

export async function confirmPayment(orderId: string) {
  const staff = await requireStaff()
  const db = await getServerClient()

  const { error } = await db
    .from('orders')
    .update({
      status: 'confirmed',
      verified_by: staff.id,
      verified_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('status', 'awaiting_verification')

  if (error) throw new Error(`Could not confirm the order: ${error.message}`)

  // Only now does the customer hear anything -- the whole point of the
  // verification gate.
  const data = await emailDataFor(orderId)
  const to = await customerEmail(orderId)
  if (data && to) {
    void sendEmail({
      to: [to],
      subject: customerConfirmSubject(data),
      text: customerConfirmBody(data),
    })
  }

  revalidatePath('/admin/orders')
  revalidatePath('/admin', 'layout')
}

export async function rejectPayment(orderId: string, reason: string) {
  await requireStaff()
  if (!reason.trim()) throw new Error('Give a reason so the customer knows what happened')

  const db = await getServerClient()
  const { error } = await db
    .from('orders')
    .update({ status: 'rejected', staff_note: reason.trim() })
    .eq('id', orderId)

  if (error) throw new Error(`Could not reject the order: ${error.message}`)

  const data = await emailDataFor(orderId)
  const to = await customerEmail(orderId)
  if (data && to) {
    void sendEmail({
      to: [to],
      subject: customerRejectSubject(data),
      text: customerRejectBody(data, reason.trim()),
    })
  }

  revalidatePath('/admin/orders')
  revalidatePath('/admin', 'layout')
}

export async function advanceStatus(orderId: string, to: OrderStatus) {
  await requireStaff()
  const db = await getServerClient()

  const { error } = await db.from('orders').update({ status: to }).eq('id', orderId)
  if (error) throw new Error(`Could not update the order: ${error.message}`)

  revalidatePath('/admin/orders')
  revalidatePath('/admin', 'layout')
}

/** Short-lived signed URL. The bucket is private; staff never get a raw path. */
export async function proofUrl(path: string): Promise<string | null> {
  await requireStaff()
  const { data } = await getAdminClient()
    .storage.from(PROOF_BUCKET)
    .createSignedUrl(path, 300)
  return data?.signedUrl ?? null
}
