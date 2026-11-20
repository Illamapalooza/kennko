import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type postgres from 'postgres'
import type { AppEnv } from './auth.js'
import { apiError } from './http.js'
import type { AuthAdmin } from './auth-admin.js'
import { attentionRoutes } from './routes/attention.js'
import { deviceRoutes } from './routes/devices.js'
import { meRoutes } from './routes/me.js'
import { menuRoutes } from './routes/menu.js'
import { ordersRoutes } from './routes/orders.js'
import { paymentRoutes } from './routes/payments.js'
import { pushRoutes } from './routes/push.js'
import { reportRoutes } from './routes/reports.js'
import { staffRoutes } from './routes/staff.js'
import { syncRoutes } from './routes/sync.js'
import type { PushSender } from './push/send.js'
import type { ProofStore } from './storage.js'

export type AppDeps = {
  sql: postgres.Sql
  verifyUser: (token: string) => Promise<{ userId: string }>
  proofs: ProofStore
  /** Supabase Auth admin (service key): confirmed-email lookups for history, staff invites. */
  authAdmin: AuthAdmin
  /** Injected so tests can pin the clock. */
  now: () => Date
  /** Order code generator; defaults to `KNK-` + 6 characters. Tests inject collisions. */
  orderCode?: () => string
  /** Web Push sender; null when VAPID keys are not configured. */
  push: PushSender | null
  /** Shared with browsers by GET /v1/push/public-key. */
  vapidPublicKey?: string | null
  /**
   * Runs post-commit push work off the response path. Production hands it to `waitUntil`; tests
   * return the task's promise so they can await it.
   */
  defer: (task: () => Promise<void>) => void | Promise<void>
  /** `KENNKO_WEB_KEY`: opens `GET /v1/staff/alert-emails` and nothing else. Null turns that route off (503). */
  webKey: string | null
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

  app.route('/v1/attention', attentionRoutes(deps))
  app.route('/v1/devices', deviceRoutes(deps))
  app.route('/v1/me', meRoutes(deps))
  app.route('/v1/menu', menuRoutes(deps))
  app.route('/v1/orders', ordersRoutes(deps))
  app.route('/v1/payments', paymentRoutes(deps))
  app.route('/v1/push', pushRoutes(deps))
  app.route('/v1/reports', reportRoutes(deps))
  app.route('/v1/staff', staffRoutes(deps))
  app.route('/v1/sync', syncRoutes(deps))

  return app
}
