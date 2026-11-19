import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type postgres from 'postgres'
import type { AppEnv } from './auth.js'
import { apiError } from './http.js'
import { menuRoutes } from './routes/menu.js'
import { ordersRoutes } from './routes/orders.js'
import type { ProofStore } from './storage.js'

export type AppDeps = {
  sql: postgres.Sql
  verifyUser: (token: string) => Promise<{ userId: string }>
  proofs: ProofStore
  /** Injected so tests can pin the clock. */
  now: () => Date
  /** Order code generator; defaults to `KNK-` + 6 characters. Tests inject collisions. */
  orderCode?: () => string
}

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.notFound(() => {
    throw apiError(404, 'NOT_FOUND', 'Not found')
  })

  app.onError((err, c) => {
    if (err instanceof HTTPException && err.res) return err.res
    console.error(err)
    return c.json({ code: 'INTERNAL', message: 'Something went wrong' }, 500)
  })

  app.get('/health', async (c) => {
    await deps.sql`select 1`
    return c.json({ ok: true })
  })

  app.route('/v1/menu', menuRoutes(deps))
  app.route('/v1/orders', ordersRoutes(deps))

  return app
}
