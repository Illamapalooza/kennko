import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps } from '../create-app.js'
import { optionalUser, requireStaff, type AppEnv } from '../auth.js'
import { invalid } from '../http.js'
import { watchOrder } from '../push/notify.js'

const subscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.url().max(2048),
    keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
  }),
  orderCode: z.string().trim().min(1).max(40).optional(),
})
const unwatchSchema = z.object({ endpoint: z.string().min(1).max(2048), orderCode: z.string().trim().min(1).max(40) })
const unsubscribeSchema = z.object({ endpoint: z.string().min(1).max(2048) })

const notFound = () =>
  Response.json({ code: 'NOT_FOUND', message: 'Not found', errors: ['Not found'] }, { status: 404 })

export function pushRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const { sql } = deps

  app.get('/public-key', (c) => {
    if (!deps.push || !deps.vapidPublicKey) return notFound()
    return c.json({ publicKey: deps.vapidPublicKey })
  })

  // Staff when a bearer token is present and no order code; otherwise the order code is the proof.
  app.post('/subscriptions', optionalUser(deps), async (c) => {
    const body = subscribeSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return invalid('Send a push subscription (endpoint and keys).')
    const { subscription, orderCode } = body.data

    if (orderCode === undefined) {
      if (!c.req.header('Authorization')) return invalid('Send an order code, or sign in as staff.')
      await requireStaff(deps)(c, async () => {})
      const [row] = await sql<{ id: string }[]>`
        insert into push_subscriptions (endpoint, p256dh, auth, kind, staff_id)
        values (${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth}, 'staff', ${c.get('staff').id})
        on conflict (endpoint) do update set
          p256dh = excluded.p256dh, auth = excluded.auth, kind = 'staff',
          staff_id = excluded.staff_id, customer_user_id = null
        returning id`
      await sql`delete from push_order_watch where subscription_id = ${row!.id}`
      return c.json({ ok: true }, 201)
    }

    const [order] = await sql<{ id: string }[]>`select id from orders where order_code = ${orderCode}`
    if (!order) return notFound()

    const userId = c.get('userId')
    const [row] = await sql<{ id: string }[]>`
      insert into push_subscriptions (endpoint, p256dh, auth, kind, customer_user_id)
      values (${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth}, 'customer', ${userId})
      on conflict (endpoint) do update set
        p256dh = case when push_subscriptions.kind = 'customer' then excluded.p256dh else push_subscriptions.p256dh end,
        auth = case when push_subscriptions.kind = 'customer' then excluded.auth else push_subscriptions.auth end,
        customer_user_id = case when push_subscriptions.kind = 'customer'
          then coalesce(excluded.customer_user_id, push_subscriptions.customer_user_id)
          else push_subscriptions.customer_user_id end
      returning id`
    // One browser subscription per device: a staff device keeps its kind, keys and owner, and just gains the watch.
    await watchOrder(sql, row!.id, order.id)
    return c.json({ ok: true }, 201)
  })

  app.delete('/subscriptions', async (c) => {
    const body = unsubscribeSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return invalid('Send the endpoint to remove.')
    await sql`delete from push_subscriptions where endpoint = ${body.data.endpoint}`
    return c.body(null, 204)
  })

  // Stop following one order on this device; the subscription itself stays.
  app.delete('/subscriptions/watch', async (c) => {
    const body = unwatchSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return invalid('Send the endpoint and the order code.')
    await sql`
      delete from push_order_watch
      where subscription_id in (select id from push_subscriptions where endpoint = ${body.data.endpoint})
        and order_id in (select id from orders where order_code = ${body.data.orderCode})`
    return c.body(null, 204)
  })

  return app
}
