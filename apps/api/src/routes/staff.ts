import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps } from '../create-app.js'
import { requireStaff, requireWebKey, type AppEnv } from '../auth.js'
import { apiError, invalid } from '../http.js'
import { AuthAdminError } from '../auth-admin.js'
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

/** A login the API invited is taken back on a failed insert, except on these (Ruling 15). */
const KEEP_LOGIN = new Set(['ALREADY_STAFF', 'EMAIL_TAKEN'])

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function staffRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const { sql } = deps

  app.get('/', requireStaff(deps, 'owner'), async (c) => {
    const rows = await sql<StaffRow[]>`select ${sql.unsafe(COLUMNS)} from staff order by created_at, id`
    return c.json({ staff: rows.map(toStaffView) })
  })

  /**
   * The website's checkout alert (Ruling 13): active staff with an email. Behind the shared website
   * key alone, which opens nothing else; a staff login does not open it.
   */
  app.get('/alert-emails', requireWebKey(deps), async (c) => {
    const rows = await sql<{ email: string }[]>`
      select email from staff where is_active and email is not null order by created_at, id`
    return c.json({ emails: rows.map((r) => r.email) }, 200, { 'cache-control': 'no-store' })
  })

  app.post('/', requireStaff(deps, 'owner'), async (c) => {
    const body = createSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return invalid('Give a name (1 to 80 characters) and a role.')
    const { fullName: name, role: r, email } = body.data
    let userId = body.data.userId
    // An owner or manager with an email and no login yet: the API sends the invite (Ruling 15). A body
    // with a userId is the old website, which invited them itself.
    let invited: string | null = null
    if (!userId && r !== 'barista' && email) {
      // Already staff: answer before inviting, so no invite email goes out and no login is left behind.
      const [taken] = await sql`select 1 from staff where lower(email) = lower(${email})`
      if (taken) throw apiError(409, 'EMAIL_TAKEN', 'That email already belongs to a staff member.')
      try {
        userId = (await deps.authAdmin.invite(email)).userId
      } catch (err) {
        console.error('Staff invite failed:', message(err))
        // GoTrue answers 422 when the address already has a confirmed login. Our text, never its body.
        if (err instanceof AuthAdminError && err.status === 422) {
          throw apiError(
            409,
            'ALREADY_REGISTERED',
            'That email already has a website login. Use a different email, or ask them to sign in first.',
          )
        }
        throw apiError(502, 'INVITE_FAILED', 'Could not send the invite. Try again.')
      }
      invited = userId
    }
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
      const code =
        e.code === '23505' ? (e.constraint_name === 'staff_user_id_key' ? 'ALREADY_STAFF' : 'EMAIL_TAKEN') : null
      // The invite may have made a login nobody can use without a staff row: take it back so a retry can
      // invite again. Not on ALREADY_STAFF or EMAIL_TAKEN: GoTrue re-sends an invite to an existing
      // unconfirmed user and returns that same user, so the login was there before this call.
      if (invited && !(code && KEEP_LOGIN.has(code))) await deleteInvitedLogin(invited)
      if (code === 'ALREADY_STAFF') throw apiError(409, 'ALREADY_STAFF', 'That login already belongs to a staff member.')
      if (code === 'EMAIL_TAKEN') throw apiError(409, 'EMAIL_TAKEN', 'That email already belongs to a staff member.')
      if (e.code === '23503' && e.constraint_name === 'staff_user_id_fkey') {
        return invalid('That login does not exist.')
      }
      throw err
    }
  })

  /** Best effort: a failure is logged (by id, never the email) and the insert's error is still the answer. */
  async function deleteInvitedLogin(id: string): Promise<void> {
    try {
      await deps.authAdmin.deleteUser(id)
    } catch (err) {
      console.error(`Could not delete the invited login ${id}:`, message(err))
    }
  }

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
