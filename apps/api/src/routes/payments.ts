import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps } from '../create-app.js'
import { requireStaff, type AppEnv } from '../auth.js'
import { decidePayment } from '../orders/actions.js'
import { invalid, respond } from '../http.js'

const rejectSchema = z.object({ reason: z.string().trim().min(1).max(300) })

export function paymentRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.post('/:id/verify', requireStaff(deps), async (c) =>
    respond(c, await decidePayment(deps, { paymentId: c.req.param('id'), staffId: c.get('staff').id, decision: 'verify' })),
  )

  app.post('/:id/reject', requireStaff(deps), async (c) => {
    const body = rejectSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return invalid('A reason of 1 to 300 characters is required.')
    return respond(
      c,
      await decidePayment(deps, {
        paymentId: c.req.param('id'),
        staffId: c.get('staff').id,
        decision: 'reject',
        reason: body.data.reason,
      }),
    )
  })

  return app
}
