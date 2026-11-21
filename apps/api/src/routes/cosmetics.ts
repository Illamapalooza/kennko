import { Hono } from 'hono'
import type { AppEnv } from '../auth.js'
import type { AppDeps } from '../create-app.js'
import { activeCosmetics } from '../loyalty/cats.js'

/** The cosmetics shop. Public: no customer data, points only. */
export function cosmeticRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    return c.json(await activeCosmetics(deps.sql), 200, { 'cache-control': 'public, max-age=60' })
  })

  return app
}
