import { Hono } from 'hono'
import type { AppDeps } from '../create-app.js'
import type { AppEnv } from '../auth.js'
import { readPublicWall } from '../wall/read.js'

export function wallRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const snap = await readPublicWall(deps.sql, deps.now())
    c.header('Cache-Control', 'public, max-age=5')
    return c.json(snap)
  })

  return app
}
