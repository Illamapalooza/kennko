import { Hono } from 'hono'
import { requireUser, type AppEnv } from '../auth.js'
import type { AppDeps } from '../create-app.js'
import { apiError } from '../http.js'
import { readHistory } from '../orders/read.js'

/** The signed-in customer's own data (customer JWT). */
export function meRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', requireUser(deps))

  // History moves unchanged (Ruling 11). The JWT does not say reliably whether the email is
  // confirmed, and guest orders under that address are only theirs once it is, so ask Auth.
  app.get('/orders', async (c) => {
    const userId = c.get('userId')!
    let user: Awaited<ReturnType<AppDeps['authAdmin']['getUser']>>
    try {
      user = await deps.authAdmin.getUser(userId)
    } catch (err) {
      console.error('[me/orders] auth lookup failed:', (err as Error).message)
      throw apiError(503, 'AUTH_UNAVAILABLE', 'Your orders could not be loaded. Try again shortly.')
    }
    if (!user) throw apiError(401, 'UNAUTHENTICATED', 'This account no longer exists')
    c.header('cache-control', 'no-store')
    return c.json({ orders: await readHistory(deps.sql, { id: userId, ...user }) })
  })

  return app
}
