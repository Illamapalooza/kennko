import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { apiBase } from '@/lib/api/client'
import { getCurrentCustomer } from '@/lib/auth/customer'
import { getServerClient } from '@/lib/supabase/server'
import { allowRequest } from '@/lib/orders/rate-limit'
import { sendEmail, activeStaffEmails } from '@/lib/email/send'
import { staffAlertSubject, staffAlertBody } from '@/lib/email/templates'

/** What the staff alert reads from the customer's own submission. */
type Submitted = {
  name?: string
  fulfilment?: 'pickup' | 'delivery'
  fulfilAt?: string
  address?: string
}

type Created = {
  orderCode: string
  ticket: string
  items: { name: string; variantLabel: string; quantity: number; ice: string | null; note: string | null }[]
  totalCentavos: number
}

const UNAVAILABLE = {
  code: 'ORDERING_UNAVAILABLE',
  errors: ['Ordering is unavailable right now. Please try again in a few minutes.'],
}

/**
 * Checkout proxy: the API owns validation, pricing and storage. This route keeps the website's
 * own concerns (ordering switch, rate limit, the customer's session, the staff alert email).
 */
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

  const base = apiBase()
  if (!base) return NextResponse.json(UNAVAILABLE, { status: 503 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json(
      { code: 'MALFORMED', errors: ['The order could not be read.'] },
      { status: 400 },
    )
  }

  const headers: Record<string, string> = { 'x-forwarded-for': ip }
  // The token comes from the session, never from the request: a request cannot claim to be
  // somebody else's account.
  const customer = await getCurrentCustomer()
  if (customer) {
    const token = (await (await getServerClient()).auth.getSession()).data.session?.access_token
    if (token) headers.Authorization = `Bearer ${token}`
  }

  let res: Response
  try {
    res = await fetch(`${base}/v1/orders`, {
      method: 'POST',
      headers,
      body: form,
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    })
  } catch (cause) {
    console.error('[orders] API unreachable', cause)
    return NextResponse.json(UNAVAILABLE, { status: 503 })
  }

  const body = (await res.json().catch(() => null)) as
    | (Partial<Created> & { code?: string; errors?: string[] })
    | null

  if (res.status !== 201 || !body?.orderCode || !body.ticket) {
    if (res.ok) return NextResponse.json(UNAVAILABLE, { status: 503 })
    return NextResponse.json(
      {
        code: body?.code ?? 'ORDER_FAILED',
        errors: body?.errors?.length ? body.errors : ['The order could not be placed.'],
      },
      { status: res.status },
    )
  }
  const created = body as Created

  // Email is best-effort: the order is already saved, so a send failure must not fail the request.
  let submitted: Submitted = {}
  try {
    const raw = form.get('order')
    if (typeof raw === 'string') submitted = JSON.parse(raw) as Submitted
  } catch {
    // The API accepted it, so this only costs the alert some detail.
  }
  const fulfilment = submitted.fulfilment === 'delivery' ? 'delivery' : 'pickup'
  const emailData = {
    orderCode: created.orderCode,
    ticket: created.ticket,
    customerName: submitted.name ?? '',
    fulfilment,
    fulfilAt: submitted.fulfilAt ?? '',
    totalCentavos: created.totalCentavos,
    deliveryAddress: fulfilment === 'delivery' ? (submitted.address ?? null) : null,
    // Names come from the API's repriced result, not the request.
    items: created.items,
  } as const

  void sendEmail({
    to: await activeStaffEmails(),
    subject: staffAlertSubject(emailData),
    text: staffAlertBody(emailData),
  })

  return NextResponse.json({ orderCode: created.orderCode, ticket: created.ticket }, { status: 201 })
}
