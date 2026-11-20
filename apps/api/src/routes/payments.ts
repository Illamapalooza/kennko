import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps } from '../create-app.js'
import { requireStaff, type AppEnv } from '../auth.js'
import { decidePayment } from '../orders/actions.js'
import { readPaymentNotice, readProofPath } from '../orders/notice.js'
import { apiError, invalid, respond } from '../http.js'

/** Long enough to open the image, short enough that a copied link soon stops working. */
const PROOF_LINK_SECONDS = 300

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

  /** Any staff member may view a proof (as on the website today). The bucket is private: a short signed link only. */
  app.get('/:id/proof', requireStaff(deps), async (c) => {
    const path = await readProofPath(deps.sql, c.req.param('id'))
    if (!path) throw apiError(404, 'NOT_FOUND', 'Not found')
    return c.json({ url: await deps.proofs.signedUrl(path, PROOF_LINK_SECONDS) }, 200, { 'cache-control': 'no-store' })
  })

  /** The order data for the website's customer emails (Ruling 14), with the full receipt fields. */
  app.get('/:id/notice', requireStaff(deps), async (c) => {
    const result = await readPaymentNotice(deps.sql, c.req.param('id'))
    if (!result.ok) {
      if (result.reason === 'no_email') throw apiError(404, 'NO_EMAIL', 'This order has no customer email.')
      throw apiError(404, 'NOT_FOUND', 'Not found')
    }
    return c.json(result.notice, 200, { 'cache-control': 'no-store' })
  })

  return app
}
