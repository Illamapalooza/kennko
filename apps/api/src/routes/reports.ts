import { summariseDay } from '@kennko/core'
import { Hono } from 'hono'
import { requireStaff, type AppEnv } from '../auth.js'
import type { AppDeps } from '../create-app.js'
import { invalid } from '../http.js'
import { readDayRows } from '../reports/day.js'

/** A real calendar day as `YYYY-MM-DD`: `2026-02-30` is not one. */
export function isDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** Reports (owner or manager, Ruling 5). */
export function reportRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', requireStaff(deps, 'manager'))

  app.get('/day/:date', async (c) => {
    const date = c.req.param('date')
    if (!isDay(date)) return invalid('date is a real day, YYYY-MM-DD.')
    return c.json(summariseDay(await readDayRows(deps.sql, date)))
  })

  return app
}
