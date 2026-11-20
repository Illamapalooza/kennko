import { IMPORT_CHUNK_MAX, MAX_PUSH_EVENTS } from '@kennko/core'
import { Hono } from 'hono'
import type { AppDeps } from '../create-app.js'
import { requireDevice, type AppEnv } from '../auth.js'
import { apiError } from '../http.js'
import { importChunk, importChunkSchema } from '../sync/import.js'
import { readPullState } from '../sync/pull.js'
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

  app.post('/import', requireDevice(deps), async (c) => {
    const body = importChunkSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) {
      const issue = body.error.issues[0]
      const where = issue && issue.path.length > 0 ? ` (${issue.path.join('.')}: ${issue.message})` : issue ? ` (${issue.message})` : ''
      throw apiError(400, 'INVALID', `Send shifts, orders and cashMoves, at most ${IMPORT_CHUNK_MAX} rows in all${where}.`)
    }
    const res = await importChunk(deps, c.get('device').id, body.data)
    c.header('Cache-Control', 'no-store')
    return c.json(res)
  })

  app.get('/pull', requireDevice(deps), async (c) => {
    const raw = Number(c.req.query('version'))
    const version = Number.isInteger(raw) && raw > 0 ? raw : null
    const state = await readPullState(deps.sql, version)
    c.header('Cache-Control', 'no-store')
    return c.json(state)
  })

  return app
}
