import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { AppDeps } from '../create-app.js'
import { optionalUser, requireStaff, type AppEnv } from '../auth.js'
import { apiError, invalid, respond } from '../http.js'
import { cancelOrder, patchOrder } from '../orders/actions.js'
import { createOnlineOrder, type SubmittedOrder } from '../orders/create.js'
import { readPublicOrder, readReceipt } from '../orders/read.js'

const lineSchema = z.object({
  menuItemId: z.string(),
  size: z.string(),
  quantity: z.number(),
  modifierIds: z.array(z.string()),
  iceLevel: z.enum(['regular', 'less', 'none']).nullable(),
  iceServe: z.enum(['mixed', 'side']).nullable(),
  note: z.string().optional(),
})

// Shape only: field rules are validateCheckout's job, prices are priceOnlineOrder's.
const orderSchema = z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  fulfilment: z.enum(['pickup', 'delivery']),
  address: z.string(),
  barangay: z.string(),
  fulfilAt: z.string(),
  gcashReference: z.string(),
  note: z.string().optional().default(''),
  lines: z.array(lineSchema),
  claimedTotalCentavos: z.number().int(),
  pin: z.object({ lat: z.number(), lng: z.number(), accuracyM: z.number().nullable() }).nullish(),
})

const MALFORMED = 'The order could not be read.'
const TOO_LARGE = 'That photo is too large. Use one under 5 MB.'
// The proof cap plus room for the order JSON and multipart framing.
const MAX_BODY_BYTES = 5 * 1024 * 1024 + 64 * 1024

function malformed() {
  return Response.json({ code: 'MALFORMED', message: MALFORMED, errors: [MALFORMED] }, { status: 400 })
}

const patchSchema = z
  .object({
    prepStatus: z.enum(['placed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled']).optional(),
    staffNote: z.string().max(500).optional(),
  })
  .refine((b) => b.prepStatus !== undefined || b.staffNote !== undefined, 'Send a prepStatus or a staffNote.')

const cancelSchema = z.object({ reason: z.string().trim().min(1).max(300) })

export function ordersRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  const limit = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ code: 'BAD_PROOF', message: TOO_LARGE, errors: [TOO_LARGE] }, 413),
  })

  app.post('/', limit, optionalUser(deps), async (c) => {
    let form: FormData
    try {
      form = await c.req.formData()
    } catch {
      return malformed()
    }
    const payload = form.get('order')
    const proof = form.get('proof')
    if (typeof payload !== 'string' || !(proof instanceof File)) return malformed()

    let json: unknown
    try {
      json = JSON.parse(payload)
    } catch {
      return malformed()
    }
    const parsed = orderSchema.safeParse(json)
    if (!parsed.success) return malformed()

    const result = await createOnlineOrder(deps, {
      order: parsed.data as SubmittedOrder,
      proof: { bytes: new Uint8Array(await proof.arrayBuffer()), contentType: proof.type },
      userId: c.get('userId'),
    })

    if (!result.ok) {
      return c.json({ code: result.code, message: result.errors[0], errors: result.errors }, result.status)
    }
    const { ok: _ok, ...body } = result
    return c.json(body, 201)
  })

  // Public, keyed on the order code: today's projections exactly (Ruling 10). Never cached, so a
  // status change shows on the next refresh and no shared cache keeps a customer's order.
  app.get('/by-code/:code', async (c) => {
    const order = await readPublicOrder(deps.sql, c.req.param('code'))
    if (!order) throw apiError(404, 'NOT_FOUND', 'No order with that code')
    c.header('cache-control', 'no-store')
    return c.json(order)
  })

  app.get('/by-code/:code/receipt', async (c) => {
    const receipt = await readReceipt(deps.sql, c.req.param('code'))
    if (!receipt) throw apiError(404, 'NOT_FOUND', 'No order with that code')
    c.header('cache-control', 'no-store')
    return c.json(receipt)
  })

  app.patch('/:id', requireStaff(deps), async (c) => {
    const body = patchSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) {
      return invalid('Send a prepStatus, or a staffNote of at most 500 characters.')
    }
    return respond(
      c,
      await patchOrder(deps, { orderId: c.req.param('id'), staffId: c.get('staff').id, ...body.data }),
    )
  })

  app.post('/:id/cancel', requireStaff(deps, 'owner'), async (c) => {
    const body = cancelSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return invalid('A reason of 1 to 300 characters is required.')
    return respond(
      c,
      await cancelOrder(deps, { orderId: c.req.param('id'), staffId: c.get('staff').id, reason: body.data.reason }),
    )
  })

  return app
}
