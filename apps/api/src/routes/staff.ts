import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps } from '../create-app.js'
import { requireStaff, type AppEnv } from '../auth.js'
import { apiError, invalid } from '../http.js'
import { issuePin, toStaffView, type StaffRow } from '../staff/manage.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const role = z.enum(['owner', 'manager', 'barista'])
const fullName = z.string().trim().min(1).max(80)
const createSchema = z.object({
  fullName,
  role,
  userId: z.string().regex(UUID).optional(),
  email: z.email().optional(),
})
const patchSchema = z
  .object({ fullName: fullName.optional(), role: role.optional(), isActive: z.boolean().optional() })
  .refine((b) => b.fullName !== undefined || b.role !== undefined || b.isActive !== undefined)

const COLUMNS = 'id, full_name, email, role, is_active, user_id, pin_hash, pin_updated_at'

export function staffRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const { sql } = deps

  app.get('/', requireStaff(deps, 'owner'), async (c) => {
    const rows = await sql<StaffRow[]>`select ${sql.unsafe(COLUMNS)} from staff order by created_at, id`
    return c.json({ staff: rows.map(toStaffView) })
  })

  app.post('/', requireStaff(deps, 'owner'), async (c) => {
    const body = createSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return invalid('Give a name (1 to 80 characters) and a role.')
    const { fullName: name, role: r, userId, email } = body.data
    if (r === 'owner' && !userId) {
      throw apiError(409, 'NEEDS_LOGIN', 'An owner needs a website login. Invite them first.')
    }
    const now = deps.now()
    try {
      const [row] = await sql<StaffRow[]>`
        insert into staff (user_id, full_name, email, role, created_at, updated_at)
        values (${userId ?? null}, ${name}, ${email ?? null}, ${r}, ${now}, ${now})
        returning ${sql.unsafe(COLUMNS)}`
      return c.json(toStaffView(row!), 201)
    } catch (err) {
      const e = err as { code?: string; constraint_name?: string }
      if (e.code === '23505' && e.constraint_name === 'staff_user_id_key') {
        throw apiError(409, 'ALREADY_STAFF', 'That login already belongs to a staff member.')
      }
      if (e.code === '23505') throw apiError(409, 'EMAIL_TAKEN', 'That email already belongs to a staff member.')
      if (e.code === '23503' && e.constraint_name === 'staff_user_id_fkey') {
        return invalid('That login does not exist.')
      }
      throw err
    }
  })

  app.patch('/:id', requireStaff(deps, 'owner'), async (c) => {
    const id = c.req.param('id')
    if (!UUID.test(id)) throw apiError(404, 'NOT_FOUND', 'Not found')
    const body = patchSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return invalid('Change a name, a role or whether the person is active.')
    const now = deps.now()

    const view = await sql.begin(async (tx) => {
      // Lock every active owner (and so serialise concurrent changes) before judging the result.
      const owners = await tx<{ id: string }[]>`select id from staff where is_active and role = 'owner' for update`
      const [cur] = await tx<StaffRow[]>`select ${tx.unsafe(COLUMNS)} from staff where id = ${id} for update`
      if (!cur) throw apiError(404, 'NOT_FOUND', 'Not found')

      const nextRole = body.data.role ?? cur.role
      const nextActive = body.data.isActive ?? cur.is_active
      if (nextRole === 'owner' && cur.user_id === null) {
        throw apiError(409, 'NEEDS_LOGIN', 'An owner needs a website login. Invite them first.')
      }
      const wasActiveOwner = cur.is_active && cur.role === 'owner'
      const staysActiveOwner = nextActive && nextRole === 'owner'
      if (wasActiveOwner && !staysActiveOwner && owners.length <= 1) {
        throw apiError(409, 'LAST_OWNER', 'There must always be at least one active owner.')
      }

      // Reactivating clears the PIN so one issued to someone else meanwhile cannot collide (Ruling 6).
      const reactivated = !cur.is_active && nextActive
      const [row] = await tx<StaffRow[]>`
        update staff set
          full_name = ${body.data.fullName ?? cur.full_name},
          role = ${nextRole},
          is_active = ${nextActive},
          pin_hash = ${reactivated ? null : cur.pin_hash},
          pin_updated_at = ${reactivated ? null : cur.pin_updated_at},
          updated_at = ${now}
        where id = ${id}
        returning ${tx.unsafe(COLUMNS)}`
      return toStaffView(row!)
    })
    return c.json(view)
  })

  app.post('/:id/pin', requireStaff(deps, 'owner'), async (c) => {
    const id = c.req.param('id')
    if (!UUID.test(id)) throw apiError(404, 'NOT_FOUND', 'Not found')
    const pin = await issuePin(sql, id, deps.now())
    return c.json({ pin }, 201)
  })

  return app
}
