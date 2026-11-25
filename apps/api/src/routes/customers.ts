import { LOOKUPS_PER_MINUTE, normalisePublicCode, POINTS_PER_CARD_SCAN, POINTS_PER_SOCIAL_SHARE, type TillCustomer } from '@kennko/core'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { requireDevice, requireStaff, type AppEnv } from '../auth.js'
import type { AppDeps } from '../create-app.js'
import { apiError, invalid } from '../http.js'
import {
  addAdjustment,
  customerDetail,
  paperStamps,
  resolvePaperStamp,
  searchCustomers,
  setCatHidden,
  setStampMode,
  type Failure,
} from '../loyalty/admin.js'
import { claimFreeDrink, sweepStrandedClaims, sweepStrandedClaimsQuietly, unclaim } from '../loyalty/cards.js'
import { customerByCode, lockCustomer, tillCustomer } from '../loyalty/customers.js'
import { balance, creditDailyBonus } from '../loyalty/points.js'
import { hit } from '../rate-limit.js'

/** Longer than any way of writing a code (`KC-XXX-XXX-XXX` with spaces), short enough to refuse junk early. */
const CODE_INPUT_MAX = 40

const claimSchema = z.object({
  claimId: z.uuid(),
  code: z.string().max(CODE_INPUT_MAX),
  staffId: z.uuid().nullable(),
})
const releaseSchema = z.object({ claimId: z.uuid() })

const body = async (c: { req: { json(): Promise<unknown> } }) => c.req.json().catch(() => null)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A path id that is not a uuid is simply not found. */
function uuidParam(c: Context<AppEnv>, name: string): string {
  const id = c.req.param(name) ?? ''
  if (!UUID.test(id)) throw apiError(404, 'NOT_FOUND', 'Not found')
  return id
}
const failed = (c: Context<AppEnv>, out: Failure) => c.json({ code: out.code, message: out.message }, out.status)

const modeSchema = z.object({ mode: z.enum(['digital', 'paper']) })
const hiddenSchema = z.object({ hidden: z.boolean() })
const pointsSchema = z.object({
  delta: z
    .number()
    .int()
    .min(-10_000)
    .max(10_000)
    .refine((d) => d !== 0),
  note: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((s) => !s.includes('\u0000')),
})

const badCode = () => apiError(400, 'BAD_CODE', 'That is not a Kennko card code. Check it and try again.')
const unknownCustomer = () => apiError(404, 'UNKNOWN_CUSTOMER', 'No Kennko card has that code.')

/** Till routes for one customer by card code (device token). Only `TillCustomer` ever leaves here. */
export function customerRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/by-code/:code', requireDevice(deps), async (c) => {
    if (!(await hit(deps.sql, `lookup:${c.get('device').id}`, LOOKUPS_PER_MINUTE, deps.now()))) {
      throw apiError(429, 'RATE_LIMITED', 'Too many card lookups from this till. Wait a minute and try again.')
    }
    const bare = normalisePublicCode(c.req.param('code'))
    if (bare === null) throw badCode()
    const [known] = await deps.sql<{ id: string }[]>`select id from customers where public_code = ${bare}`
    const now = deps.now()
    if (known) await sweepStrandedClaimsQuietly(deps.sql, now, 'lookup', [known.id])
    const found = await deps.sql.begin(async (tx) => {
      const customer = await customerByCode(tx, bare)
      if (!customer) return null
      await creditDailyBonus(tx, {
        customerId: customer.id,
        reason: 'card_scan',
        delta: POINTS_PER_CARD_SCAN,
        note: 'Scanned Kennko card at counter',
        now,
      })
      return await tillCustomer(tx, customer.id)
    })
    if (!found) throw unknownCustomer()
    c.header('Cache-Control', 'no-store')
    return c.json(found as TillCustomer)
  })

  app.post('/by-code/:code/bonus', requireDevice(deps), async (c) => {
    const bare = normalisePublicCode(c.req.param('code'))
    if (bare === null) throw badCode()
    const raw = (await body(c)) as { kind?: unknown; staffId?: unknown } | null
    if (!raw || raw.kind !== 'social_share') {
      return invalid('Send kind: "social_share".')
    }
    const staffId = typeof raw.staffId === 'string' && UUID.test(raw.staffId) ? raw.staffId : null
    const now = deps.now()
    const out = await deps.sql.begin(async (tx) => {
      const customer = await customerByCode(tx, bare)
      if (!customer) return null
      const res = await creditDailyBonus(tx, {
        customerId: customer.id,
        reason: 'social_share',
        delta: POINTS_PER_SOCIAL_SHARE,
        note: 'Shared a Kennko story/post (verified at counter)',
        staffId,
        now,
      })
      const total = await balance(tx, customer.id)
      return { ...res, balance: total }
    })
    if (!out) throw unknownCustomer()
    c.header('Cache-Control', 'no-store')
    return c.json(out)
  })

  // Admin (Ruling 17): lookup, detail and card mode for owners and managers; point adjustments for the owner.
  app.get('/', requireStaff(deps, 'manager'), async (c) => {
    await sweepStrandedClaimsQuietly(deps.sql, deps.now(), 'customers')
    c.header('Cache-Control', 'no-store')
    return c.json(await searchCustomers(deps.sql, c.req.query('q') ?? ''))
  })

  app.get('/:id', requireStaff(deps, 'manager'), async (c) => {
    const id = uuidParam(c, 'id')
    await sweepStrandedClaimsQuietly(deps.sql, deps.now(), 'customer', [id])
    const found = await customerDetail(deps.sql, id)
    if (!found) throw apiError(404, 'NOT_FOUND', 'Not found')
    c.header('Cache-Control', 'no-store')
    return c.json(found)
  })

  app.post('/:id/stamp-mode', requireStaff(deps, 'manager'), async (c) => {
    const customerId = uuidParam(c, 'id')
    const parsed = modeSchema.safeParse(await body(c))
    if (!parsed.success) return invalid('mode is digital or paper.')
    const out = await setStampMode(deps.sql, { customerId, mode: parsed.data.mode, staffId: c.get('staff').id, now: deps.now() })
    return out.ok ? c.json({ stampMode: out.stampMode, changed: out.changed }) : failed(c, out)
  })

  app.post('/:id/cat/hidden', requireStaff(deps, 'manager'), async (c) => {
    const customerId = uuidParam(c, 'id')
    const parsed = hiddenSchema.safeParse(await body(c))
    if (!parsed.success) return invalid('hidden is true or false.')
    const out = await setCatHidden(deps.sql, { customerId, hidden: parsed.data.hidden, staffId: c.get('staff').id, now: deps.now() })
    if (!out.ok) return failed(c, out)
    const found = await customerDetail(deps.sql, customerId)
    if (!found) throw apiError(404, 'NOT_FOUND', 'Not found')
    c.header('Cache-Control', 'no-store')
    return c.json(found)
  })

  app.post('/:id/points', requireStaff(deps, 'owner'), async (c) => {
    const customerId = uuidParam(c, 'id')
    const parsed = pointsSchema.safeParse(await body(c))
    if (!parsed.success) return invalid('Give whole points from -10000 to 10000 (not 0) and a note (1 to 200 characters).')
    const out = await addAdjustment(deps.sql, { customerId, ...parsed.data, staffId: c.get('staff').id, now: deps.now() })
    return out.ok ? c.json({ points: out.points }) : failed(c, out)
  })

  return app
}

/** Stamps to check (Ruling 13): paper-mode stamps a manager applies once the customer is digital, or discards. */
export function stampRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', requireStaff(deps, 'manager'))

  app.get('/to-check', async (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json(await paperStamps(deps.sql))
  })

  for (const action of ['apply', 'discard'] as const) {
    app.post(`/:id/${action}`, async (c) => {
      const stampId = uuidParam(c, 'id')
      const out = await resolvePaperStamp(deps.sql, { stampId, action, staffId: c.get('staff').id, now: deps.now() })
      return out.ok ? c.json({ ok: true }) : failed(c, out)
    })
  }

  return app
}

/**
 * The free-drink claim, online only (Ruling 10): the till has checked the manager PIN and calls this at charge time.
 * Release undoes a claim whose sale was never written, and only from the till that claimed it.
 */
export function stampCardRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.post('/claim', requireDevice(deps), async (c) => {
    const parsed = claimSchema.safeParse(await body(c))
    if (!parsed.success) throw apiError(400, 'INVALID', 'Send claimId (uuid), code and staffId (uuid or null).')
    const { claimId, code, staffId } = parsed.data
    const bare = normalisePublicCode(code)
    if (bare === null) throw badCode()
    const deviceId = c.get('device').id
    const now = deps.now()

    const customer = await deps.sql.begin(async (tx) => {
      const found = await customerByCode(tx, bare)
      const locked = found ? await lockCustomer(tx, found.id) : null
      if (!locked) throw unknownCustomer()
      if (locked.stamp_mode === 'paper') {
        throw apiError(409, 'PAPER_CARD', 'This customer uses a paper card. Use the paper card for the free drink.')
      }
      await sweepStrandedClaims(tx, locked.id, now)
      const [staff] = staffId ? await tx`select id from staff where id = ${staffId}` : []
      const out = await claimFreeDrink(tx, {
        customerId: locked.id,
        claimId,
        staffId: staff ? staffId : null,
        deviceId,
        now,
      })
      if (out === 'none_full') throw apiError(409, 'NO_FREE_DRINK', 'No free drink waiting on this card.')
      return tillCustomer(tx, locked.id)
    })
    c.header('Cache-Control', 'no-store')
    return c.json({ customer })
  })

  app.post('/release', requireDevice(deps), async (c) => {
    const parsed = releaseSchema.safeParse(await body(c))
    if (!parsed.success) throw apiError(400, 'INVALID', 'Send claimId (uuid).')
    const { claimId } = parsed.data
    const deviceId = c.get('device').id
    const now = deps.now()

    const released = await deps.sql.begin(async (tx) => {
      type Card = { id: string; customer_id: string; claimed_device_id: string | null; claimed_order_id: string | null }
      const find = () => tx<Card[]>`
        select id, customer_id, claimed_device_id, claimed_order_id from stamp_cards where claim_id = ${claimId}`
      const releasable = (card: Card | undefined): card is Card =>
        card !== undefined && card.claimed_device_id === deviceId && card.claimed_order_id === null
      const [before] = await find()
      if (!releasable(before)) return false
      await lockCustomer(tx, before.customer_id)
      // Read again under the customer lock: a reward.used may have recorded the sale meanwhile.
      const [card] = await find()
      if (!releasable(card)) return false
      return (await unclaim(tx, { cardId: card.id }, now)) === 'unclaimed'
    })
    c.header('Cache-Control', 'no-store')
    return c.json({ released })
  })

  return app
}
