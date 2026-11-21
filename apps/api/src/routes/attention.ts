import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { closeShift, markOrderSeen, resolveEvent, retryDevice, type ActionResult } from '../attention/actions.js'
import { countAttention, readAttention } from '../attention/read.js'
import { requireStaff, type AppEnv } from '../auth.js'
import { sweepStrandedClaimsFor } from '../loyalty/cards.js'
import type { AppDeps } from '../create-app.js'
import { apiError, invalid } from '../http.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const note = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((s) => !s.includes('\u0000'))
const showSchema = z.enum(['open', 'resolved'])
const resolveSchema = z.object({ action: z.enum(['discard', 'seen']), note })
const closeSchema = z.object({ countedCentavos: z.number().int().min(0).max(100_000_000), note })

/** A path id that is not a uuid is simply not found. */
function uuidParam(c: Context<AppEnv>, name: string): string {
  const id = c.req.param(name) ?? ''
  if (!UUID.test(id)) throw apiError(404, 'NOT_FOUND', 'Not found')
  return id
}

const body = (c: Context<AppEnv>) => c.req.json().catch(() => null)

function respond(c: Context<AppEnv>, out: ActionResult) {
  return out.ok ? c.json({ ok: true }) : c.json({ code: out.code, message: out.message }, out.status)
}

/** Needs a look (owner only, Ruling 5): held and flagged receipts, flagged orders, stuck shifts. */
export function attentionRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', requireStaff(deps, 'owner'))

  app.get('/', async (c) => {
    const show = showSchema.safeParse(c.req.query('show') ?? 'open')
    if (!show.success) return invalid('show is open or resolved.')
    // Stranded free-drink claims go back to full cards (Ruling P7-6) whenever the owner looks.
    await sweepStrandedClaimsFor(deps.sql, deps.now())
    return c.json(await readAttention(deps.sql, show.data))
  })

  app.get('/count', async (c) => c.json({ count: await countAttention(deps.sql) }))

  app.post('/events/:deviceId/:eventId', async (c) => {
    const deviceId = uuidParam(c, 'deviceId')
    const eventId = uuidParam(c, 'eventId')
    const parsed = resolveSchema.safeParse(await body(c))
    if (!parsed.success) return invalid('Choose discard or seen, and give a note (1 to 200 characters).')
    return respond(c, await resolveEvent(deps, { deviceId, eventId, ...parsed.data, staffId: c.get('staff').id }))
  })

  app.post('/devices/:deviceId/retry', async (c) => {
    const out = await retryDevice(deps, uuidParam(c, 'deviceId'))
    return out.ok ? c.json({ held: out.held }) : c.json({ code: out.code, message: out.message }, out.status)
  })

  app.post('/shifts/:id/close', async (c) => {
    const shiftId = uuidParam(c, 'id')
    const parsed = closeSchema.safeParse(await body(c))
    if (!parsed.success) return invalid('Give the counted cash in centavos (0 if unknown) and a note (1 to 200 characters).')
    return respond(c, await closeShift(deps, { shiftId, ...parsed.data, staffId: c.get('staff').id }))
  })

  app.post('/orders/:id/seen', async (c) => {
    return respond(c, await markOrderSeen(deps, { orderId: uuidParam(c, 'id'), staffId: c.get('staff').id }))
  })

  return app
}
