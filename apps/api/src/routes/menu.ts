import { Hono } from 'hono'
import type { AppDeps } from '../app.ts'
import { requireStaff, type AppEnv } from '../auth.ts'
import { apiError } from '../http.ts'
import { readLatestMenu, readMenuVersion } from '../menu/read.ts'
import { publishMenu } from '../menu/snapshot.ts'

export function menuRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const latest = await readLatestMenu(deps.sql)
    if (!latest) throw apiError(404, 'NO_MENU', 'No menu has been published yet')
    const headers = {
      ETag: latest.etag,
      'Cache-Control': 'public, max-age=30, stale-while-revalidate=300',
    }
    const match = c.req.header('If-None-Match')
    if (match && match.split(',').some((t) => t.trim() === latest.etag)) {
      return new Response(null, { status: 304, headers })
    }
    return c.json(latest.snapshot, 200, headers)
  })

  app.post('/publish', requireStaff(deps, 'owner'), async (c) => {
    return c.json(await publishMenu(deps.sql, c.get('staff').id))
  })

  app.get('/:version', async (c) => {
    const raw = c.req.param('version')
    const version = Number(raw)
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(version)) {
      throw apiError(400, 'BAD_VERSION', 'Version must be a positive integer')
    }
    const snapshot = await readMenuVersion(deps.sql, version)
    if (!snapshot) throw apiError(404, 'NO_SUCH_VERSION', 'No such menu version')
    return c.json(snapshot, 200, { 'Cache-Control': 'public, max-age=31536000, immutable' })
  })

  return app
}
