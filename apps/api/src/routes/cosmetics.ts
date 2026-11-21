import { Hono } from 'hono'
import { z } from 'zod'
import { requireStaff, type AppEnv } from '../auth.js'
import type { AppDeps } from '../create-app.js'
import { apiError, invalid } from '../http.js'
import { activeCosmetics, allCosmetics, patchCosmetic } from '../loyalty/cats.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `key` and `slot` are not here: the art lives in code (Ruling 3), and strict rejects them. */
const patchSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(40),
    pricePoints: z.number().int().min(0).max(10_000),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(-10_000).max(10_000),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0)

/** The cosmetics shop (public: no customer data, points only) and the owner's catalogue editing. */
export function cosmeticRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    return c.json(await activeCosmetics(deps.sql), 200, { 'cache-control': 'public, max-age=60' })
  })

  app.get('/all', requireStaff(deps, 'owner'), async (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json(await allCosmetics(deps.sql))
  })

  app.patch('/:id', requireStaff(deps, 'owner'), async (c) => {
    const id = c.req.param('id')
    if (!UUID.test(id)) throw apiError(404, 'NOT_FOUND', 'Not found')
    const body = await c.req.json().catch(() => null)
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return invalid('Send name (1 to 40 characters), pricePoints (0 to 10000), isActive or sortOrder.')
    }
    const out = await patchCosmetic(deps.sql, id, parsed.data)
    if ('ok' in out) return c.json({ code: out.code, message: out.message }, out.status)
    c.header('Cache-Control', 'no-store')
    return c.json(out)
  })

  return app
}
