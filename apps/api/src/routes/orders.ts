import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps } from '../create-app.js'
import { optionalUser, type AppEnv } from '../auth.js'
import { createOnlineOrder, type SubmittedOrder } from '../orders/create.js'

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

function malformed() {
  return Response.json({ code: 'MALFORMED', message: MALFORMED, errors: [MALFORMED] }, { status: 400 })
}

export function ordersRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.post('/', optionalUser(deps), async (c) => {
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

  return app
}
