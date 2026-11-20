import { LOOKUPS_PER_MINUTE, normalisePublicCode, type TillCustomer } from '@kennko/core'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireDevice, type AppEnv } from '../auth.js'
import type { AppDeps } from '../create-app.js'
import { apiError } from '../http.js'
import { claimFreeDrink, unclaim } from '../loyalty/cards.js'
import { customerByCode, lockCustomer, tillCustomer } from '../loyalty/customers.js'
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
    const found = await deps.sql.begin(async (tx) => {
      const customer = await customerByCode(tx, bare)
      return customer ? await tillCustomer(tx, customer.id) : null
    })
    if (!found) throw unknownCustomer()
    c.header('Cache-Control', 'no-store')
    return c.json(found as TillCustomer)
  })

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
