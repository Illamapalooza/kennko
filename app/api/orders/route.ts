import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createOrder, type SubmittedOrder } from '@/lib/orders/create'
import { getCurrentCustomer } from '@/lib/auth/customer'
import { allowRequest } from '@/lib/orders/rate-limit'
import { sendEmail, activeStaffEmails } from '@/lib/email/send'
import { staffAlertSubject, staffAlertBody } from '@/lib/email/templates'

export async function POST(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_ORDERING_ENABLED !== 'true') {
    return NextResponse.json(
      { code: 'ORDERING_DISABLED', errors: ['Online ordering is not open yet.'] },
      { status: 503 },
    )
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'

  if (!allowRequest(ip)) {
    return NextResponse.json(
      { code: 'RATE_LIMITED', errors: ['Too many orders from this connection. Try again shortly.'] },
      { status: 429 },
    )
  }

  const form = await request.formData()
  const payload = form.get('order')
  const proof = form.get('proof')

  if (typeof payload !== 'string' || !(proof instanceof File)) {
    return NextResponse.json(
      { code: 'MALFORMED', errors: ['The order could not be read.'] },
      { status: 400 },
    )
  }

  let submitted: SubmittedOrder
  try {
    submitted = JSON.parse(payload) as SubmittedOrder
  } catch {
    return NextResponse.json(
      { code: 'MALFORMED', errors: ['The order could not be read.'] },
      { status: 400 },
    )
  }

  // Taken from the session, never from the payload: a request cannot claim
  // to belong to somebody else's account.
  const customer = await getCurrentCustomer()
  const result = await createOrder(submitted, proof, {
    customerUserId: customer?.id ?? null,
  })

  if (!result.ok) {
    return NextResponse.json(
      { code: result.code, errors: result.errors },
      { status: result.status },
    )
  }

  // Email is best-effort: the order is already saved, so a send failure must
  // not fail the request.
  const emailData = {
    orderCode: result.orderCode,
    customerName: submitted.name,
    fulfilment: submitted.fulfilment,
    fulfilAt: submitted.fulfilAt,
    totalCentavos: result.totalCentavos,
    deliveryAddress: submitted.fulfilment === 'delivery' ? submitted.address : null,
    // Names come from the repriced result, not the request -- the request
    // carries only ids, and the server's names are the authoritative ones.
    items: result.items,
  }

  void sendEmail({
    to: await activeStaffEmails(),
    subject: staffAlertSubject(emailData),
    text: staffAlertBody(emailData),
  })

  return NextResponse.json({ orderCode: result.orderCode }, { status: 201 })
}
