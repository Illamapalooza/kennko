import { MAX_PUSH_EVENTS } from '@kennko/core'
import { Hono } from 'hono'
import type { AppDeps } from '../create-app.js'
import { requireDevice, type AppEnv } from '../auth.js'
import { apiError } from '../http.js'
import { pushEvents } from '../sync/push.js'
import { pushBodySchema } from '../sync/schema.js'

export function syncRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.post('/push', requireDevice(deps), async (c) => {
    const body = pushBodySchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) {
      const issue = body.error.issues[0]
      const where = issue && issue.path.length > 0 ? ` (${issue.path.join('.')}: ${issue.message})` : ''
      throw apiError(400, 'INVALID', `Send 1 to ${MAX_PUSH_EVENTS} events, each with an id, seq, kind, occurredAt and staffId${where}.`)
    }
    const res = await pushEvents(deps, c.get('device').id, body.data.events)
    c.header('Cache-Control', 'no-store')
    return c.json(res)
  })

  return app
}
