import { CHECKINS_PER_MINUTE, POINTS_PER_CHECKIN } from '@kennko/core'
import { Hono } from 'hono'
import { requireUser, type AppEnv } from '../auth.js'
import type { AppDeps } from '../create-app.js'
import { apiError } from '../http.js'
import { ensureCat, NOT_JOINED } from '../loyalty/cats.js'
import { lockCustomer } from '../loyalty/customers.js'
import { creditDailyBonus } from '../loyalty/points.js'
import { checkinSecret, codeMatches, startOrExtendVisit } from '../loyalty/visits.js'
import { hit } from '../rate-limit.js'

const BAD_WALL_CODE = () => apiError(400, 'BAD_WALL_CODE', 'That code has changed. Scan the wall again.')

/** `POST /v1/checkin { code }`: a signed-in customer scanned the wall's QR (Rulings 5 and 7). */
export function checkinRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.post('/', requireUser(deps), async (c) => {
    const userId = c.get('userId')!
    const now = deps.now()
    if (!(await hit(deps.sql, `checkin:${userId}`, CHECKINS_PER_MINUTE, now))) {
      throw apiError(429, 'RATE_LIMITED', 'Too many check-ins. Try again in a minute.')
    }
    const [customer] = await deps.sql`select 1 from customers where id = ${userId}`
    if (!customer) throw apiError(NOT_JOINED.status, NOT_JOINED.code, NOT_JOINED.message)

    const body = (await c.req.json().catch(() => null)) as { code?: unknown } | null
    const code = body !== null && typeof body === 'object' && typeof body.code === 'string' ? body.code : ''
    if (!(await codeMatches(await checkinSecret(deps.sql, now), code, now))) throw BAD_WALL_CODE()

    const out = await deps.sql.begin(async (tx) => {
      // Read again under the lock: the account may have been deleted since.
      if (!(await lockCustomer(tx, userId))) return null
      await ensureCat(tx, userId, now)
      const endsAt = await startOrExtendVisit(tx, userId, now)
      const bonus = await creditDailyBonus(tx, {
        customerId: userId,
        reason: 'checkin',
        delta: POINTS_PER_CHECKIN,
        note: 'Walked cat into Kennko',
        now,
      })
      const [cat] = await tx<{ show_on_wall: boolean; hidden_by_admin: boolean }[]>`
        select show_on_wall, hidden_by_admin from cats where customer_id = ${userId}`
      return {
        endsAt: endsAt.toISOString(),
        onWall: cat!.show_on_wall && !cat!.hidden_by_admin,
        pointsAwarded: bonus.awarded,
      }
    })
    if (!out) throw apiError(NOT_JOINED.status, NOT_JOINED.code, NOT_JOINED.message)
    c.header('cache-control', 'no-store')
    return c.json(out)
  })

  return app
}
