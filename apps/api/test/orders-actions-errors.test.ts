import { describe, expect, it } from 'vitest'
import { cancelOrder, decidePayment, patchOrder } from '../src/orders/actions.js'
import type { AppDeps } from '../src/create-app.js'

const ID = '00000000-0000-4000-8000-0000000000aa'

// PGlite is single-session, so a real deadlock cannot be reproduced; this checks the mapping only.
const failing = (code: string, name = 'PostgresError'): AppDeps =>
  ({
    sql: {
      begin: async () => {
        throw Object.assign(new Error('boom'), { code, name })
      },
    },
  }) as unknown as AppDeps

describe('transaction failures', () => {
  it.each(['40P01', '40001'])('Postgres %s -> 409 STATUS_CHANGED', async (code) => {
    const results = [
      await patchOrder(failing(code), { orderId: ID, staffId: ID, staffNote: 'x' }),
      await cancelOrder(failing(code), { orderId: ID, staffId: ID, reason: 'x' }),
      await decidePayment(failing(code), { paymentId: ID, staffId: ID, decision: 'verify' }),
    ]
    for (const r of results) expect(r).toMatchObject({ ok: false, status: 409, code: 'STATUS_CHANGED' })
  })

  it('other errors still propagate', async () => {
    await expect(patchOrder(failing('23505'), { orderId: ID, staffId: ID, staffNote: 'x' })).rejects.toThrow('boom')
  })
})
