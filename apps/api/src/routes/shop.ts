import { isValidClosingTime } from '@kennko/core'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireStaff, type AppEnv } from '../auth.js'
import type { AppDeps } from '../create-app.js'
import { invalid } from '../http.js'
import { readShopStatus, updateShopStatus, withOpenNow } from '../shop/status.js'

export const shopStatusPatchSchema = z
  .object({
    isOpen: z.boolean().optional(),
    closingTime: z
      .union([z.string().refine((v) => isValidClosingTime(v), 'Use 24-hour HH:MM format, like 23:00.'), z.null()])
      .optional(),
  })
  .refine((b) => b.isOpen !== undefined || b.closingTime !== undefined, 'Provide isOpen or closingTime.')

export function shopRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const status = await readShopStatus(deps.sql)
    c.header('cache-control', 'no-store')
    return c.json(withOpenNow(status, deps.now().getTime()))
  })

  app.patch('/', requireStaff(deps), async (c) => {
    const body = shopStatusPatchSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return invalid(body.error.issues[0]?.message ?? 'Send isOpen or closingTime.')
    const status = await updateShopStatus(deps.sql, body.data, deps.now())
    c.header('cache-control', 'no-store')
    return c.json(withOpenNow(status, deps.now().getTime()))
  })

  return app
}
