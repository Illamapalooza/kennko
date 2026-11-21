import { randomInt } from 'node:crypto'
import { formatPublicCode, makePublicCode, type MeView, type StampMode } from '@kennko/core'
import { Hono } from 'hono'
import type postgres from 'postgres'
import { z } from 'zod'
import type { AuthUser } from '../auth-admin.js'
import { requireUser, type AppEnv } from '../auth.js'
import type { AppDeps } from '../create-app.js'
import { apiError, invalid } from '../http.js'
import { sweepStrandedClaimsQuietly } from '../loyalty/cards.js'
import { cardSummary, lockCustomer } from '../loyalty/customers.js'
import { balance } from '../loyalty/points.js'
import { readHistory } from '../orders/read.js'

const NAME_MAX = 40
/** Attempts at a fresh public code when one is already taken. */
const CODE_ATTEMPTS = 5

const displayName = z.string().trim().min(1).max(NAME_MAX)
const joinSchema = z.object({
  ageConfirmed: z.literal(true),
  privacyVersion: z.string().trim().min(1).max(20),
  displayName: displayName.optional(),
})
const renameSchema = z.object({ displayName })
const deleteSchema = z.object({ confirm: z.literal('DELETE') })

const body = async (c: { req: { json(): Promise<unknown> } }) => c.req.json().catch(() => null)

/** Trimmed and cut to 40; null when nothing is left. */
const fitName = (s: string | null | undefined) => {
  const t = s?.trim().slice(0, NAME_MAX).trim()
  return t ? t : null
}

/** The signed-in customer's view: the card (null on paper), the formatted code and the points balance. */
async function readMe(sql: postgres.Sql, id: string): Promise<MeView> {
  return (await sql.begin(async (tx) => {
    type Row = { public_code: string; display_name: string; created_at: Date; stamp_mode: StampMode }
    const [c] = await tx<Row[]>`
      select public_code, display_name, created_at, stamp_mode from customers where id = ${id}`
    if (!c) return { customer: null }
    return {
      customer: {
        publicCode: formatPublicCode(c.public_code),
        displayName: c.display_name,
        joinedAt: c.created_at.toISOString(),
        stampMode: c.stamp_mode,
        card: c.stamp_mode === 'paper' ? null : await cardSummary(tx, id),
        points: await balance(tx, id),
      },
    }
  })) as MeView
}

/** The signed-in customer's own data (customer JWT). */
export function meRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', requireUser(deps))
  const makeCode = deps.publicCode ?? (() => makePublicCode(randomInt))

  /** The Auth record (the JWT does not say reliably whether the email is confirmed). */
  async function authUser(userId: string, what: string, unavailable: string): Promise<AuthUser> {
    let user: AuthUser | null
    try {
      user = await deps.authAdmin.getUser(userId)
    } catch (err) {
      console.error(`[me/${what}] auth lookup failed:`, (err as Error).message)
      throw apiError(503, 'AUTH_UNAVAILABLE', unavailable)
    }
    if (!user) throw apiError(401, 'UNAUTHENTICATED', 'This account no longer exists')
    return user
  }

  app.get('/', async (c) => {
    const id = c.get('userId')!
    // A stranded free-drink claim shows as a full card again (Ruling P7-6).
    await sweepStrandedClaimsQuietly(deps.sql, deps.now(), 'me', [id])
    c.header('cache-control', 'no-store')
    return c.json(await readMe(deps.sql, id))
  })

  // "Get my Kennko card": 13+ and the privacy notice accepted. Joining twice answers the same card.
  app.post('/join', async (c) => {
    const userId = c.get('userId')!
    const parsed = joinSchema.safeParse(await body(c))
    if (!parsed.success) return invalid('Confirm you are 13 or older and accept the privacy notice.')
    c.header('cache-control', 'no-store')

    const [existing] = await deps.sql`select 1 from customers where id = ${userId}`
    if (existing) return c.json(await readMe(deps.sql, userId))

    let name = fitName(parsed.data.displayName)
    if (!name) {
      const user = await authUser(userId, 'join', 'Your card could not be made right now. Try again shortly.')
      name = fitName(user.name) ?? fitName(user.email?.split('@')[0]) ?? 'Kennko friend'
    }
    const now = deps.now()
    for (let attempt = 1; ; attempt++) {
      try {
        // A concurrent join for the same person wins quietly (on conflict on the id); only a code clash throws.
        await deps.sql`
          insert into customers (id, public_code, display_name, age_confirmed_at, privacy_accepted_at, privacy_version, created_at)
          values (${userId}, ${makeCode()}, ${name}, ${now}, ${now}, ${parsed.data.privacyVersion}, ${now})
          on conflict (id) do nothing`
        break
      } catch (err) {
        const e = err as { code?: string; constraint_name?: string }
        if (e.code === '23505' && e.constraint_name === 'customers_public_code_key' && attempt < CODE_ATTEMPTS) continue
        throw err
      }
    }
    return c.json(await readMe(deps.sql, userId))
  })

  app.patch('/', async (c) => {
    const userId = c.get('userId')!
    const parsed = renameSchema.safeParse(await body(c))
    if (!parsed.success) return invalid('A display name is 1 to 40 characters.')
    const updated = await deps.sql`
      update customers set display_name = ${parsed.data.displayName} where id = ${userId} returning id`
    if (updated.length === 0) throw apiError(404, 'NOT_JOINED', 'You do not have a Kennko card yet.')
    c.header('cache-control', 'no-store')
    return c.json(await readMe(deps.sql, userId))
  })

  /**
   * Hard deletion (Ruling 16): nothing left that points to the person. The card data goes first, in one
   * transaction, then the login; a login that is already gone counts as done, so a retry is safe. The
   * contact fields on their online orders stay as sales records.
   */
  app.delete('/', async (c) => {
    const userId = c.get('userId')!
    const parsed = deleteSchema.safeParse(await body(c))
    if (!parsed.success) return invalid('Send { "confirm": "DELETE" } to delete your account.')

    // Removing a staff login would break staff_owner_has_login and the staff row's own link.
    const [staff] = await deps.sql`select 1 from staff where user_id = ${userId}`
    if (staff) throw apiError(409, 'IS_STAFF', 'Staff logins cannot be deleted here. Ask the owner.')

    await deps.sql.begin(async (tx) => {
      // Lock order: the order rows (by id), then the customer row, as every stamp and points path does.
      await tx`
        select id from orders where customer_id = ${userId} or customer_user_id = ${userId}
        order by id for update`
      await lockCustomer(tx, userId)
      // Same condition again rather than the locked ids: an order linked just before the customer lock is caught too.
      await tx`
        update orders set customer_id = null, customer_user_id = null
        where customer_id = ${userId} or customer_user_id = ${userId}`
      await tx`delete from push_subscriptions where customer_user_id = ${userId}`
      // Cascades to the cards, the stamps and the points ledger.
      await tx`delete from customers where id = ${userId}`
    })

    try {
      await deps.authAdmin.deleteUser(userId)
    } catch (err) {
      console.error(`[me/delete] could not delete the login ${userId}:`, (err as Error).message)
      throw apiError(502, 'AUTH_DELETE_FAILED', 'Your card data is deleted, but your login could not be. Try again.')
    }
    return c.json({ deleted: true })
  })

  // History (Ruling 11). Guest orders under the address are theirs only once it is confirmed, and only
  // those placed after the login was created (Plan 7 Ruling 1).
  app.get('/orders', async (c) => {
    const userId = c.get('userId')!
    const user = await authUser(userId, 'orders', 'Your orders could not be loaded. Try again shortly.')
    c.header('cache-control', 'no-store')
    return c.json({ orders: await readHistory(deps.sql, { id: userId, ...user }) })
  })

  return app
}
