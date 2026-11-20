import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps } from '../create-app.js'
import { requireDevice, requireStaff, type AppEnv } from '../auth.js'
import { apiError, invalid } from '../http.js'
import { PAIRING_TTL_MS, pairDevice } from '../devices/pairing.js'
import { newPairingCode, sha256Hex } from '../devices/tokens.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const createSchema = z.object({ name: z.string().trim().min(1).max(40) })
const pairSchema = z.object({ code: z.string().regex(/^\d{6}$/) })

export function deviceRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const { sql } = deps

  app.post('/', requireStaff(deps, 'owner'), async (c) => {
    const body = createSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return invalid('Give the till a name (1 to 40 characters).')
    const now = deps.now()
    const expires = new Date(now.getTime() + PAIRING_TTL_MS)
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newPairingCode()
      try {
        const [row] = await sql<{ id: string; name: string }[]>`
          insert into devices (name, pairing_code_hash, pairing_expires_at, paired_by, created_at, updated_at)
          values (${body.data.name}, ${sha256Hex(code)}, ${expires}, ${c.get('staff').id}, ${now}, ${now})
          returning id, name`
        return c.json({ id: row!.id, name: row!.name, code, expiresAt: expires.toISOString() }, 201)
      } catch (err) {
        if ((err as { code?: string }).code === '23505') continue
        throw err
      }
    }
    throw apiError(503, 'CODE_BUSY', 'Could not make a pairing code. Try again.')
  })

  app.get('/', requireStaff(deps, 'owner'), async (c) => {
    const now = deps.now()
    const rows = await sql<
      { id: string; name: string; paired_at: Date | null; pairing_expires_at: Date | null; pairing_code_hash: string | null; last_seen_at: Date | null }[]
    >`select id, name, paired_at, pairing_expires_at, pairing_code_hash, last_seen_at
      from devices where revoked_at is null order by created_at desc, id`
    return c.json({
      devices: rows.map((r) => {
        const live = r.pairing_code_hash !== null && r.pairing_expires_at !== null && r.pairing_expires_at > now
        return {
          id: r.id,
          name: r.name,
          status: r.paired_at ? 'paired' : live ? 'waiting' : 'expired',
          expiresAt: r.paired_at || !r.pairing_expires_at ? null : r.pairing_expires_at.toISOString(),
          pairedAt: r.paired_at?.toISOString() ?? null,
          lastSeenAt: r.last_seen_at?.toISOString() ?? null,
        }
      }),
    })
  })

  // Registered before '/:id' so "me" and "pair" are not parsed as ids.
  app.post('/pair', async (c) => {
    const body = pairSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return invalid('The code is 6 digits.')
    const result = await pairDevice(sql, body.data.code, deps.now())
    if (!result) throw apiError(401, 'PAIRING_FAILED', 'That code is wrong or has expired. Ask the owner for a new one.')
    return c.json(result)
  })

  app.get('/me', requireDevice(deps), async (c) => {
    const device = c.get('device')
    const staff = await sql<{ id: string; full_name: string; role: string; pin_hash: string }[]>`
      select id, full_name, role, pin_hash from staff
      where is_active and pin_hash is not null order by full_name, id`
    return c.json({
      device: { id: device.id, name: device.name, ticketSeries: 'C' },
      staff: staff.map((s) => ({ id: s.id, fullName: s.full_name, role: s.role, pinHash: s.pin_hash })),
    })
  })

  app.delete('/:id', requireStaff(deps, 'owner'), async (c) => {
    const id = c.req.param('id')
    if (!UUID.test(id)) throw apiError(404, 'NOT_FOUND', 'Not found')
    const now = deps.now()
    const [row] = await sql`
      update devices set revoked_at = coalesce(revoked_at, ${now}), token_hash = null, pairing_code_hash = null, updated_at = ${now}
      where id = ${id} returning id`
    if (!row) throw apiError(404, 'NOT_FOUND', 'Not found')
    return c.body(null, 204)
  })

  return app
}
