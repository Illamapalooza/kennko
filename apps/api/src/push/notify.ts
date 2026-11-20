import { formatPesos, ticketLabel, type PrepStatus } from '@kennko/core'
import type { AppDeps } from '../create-app.js'
import type { PushPayload, PushTarget } from './send.js'

export type OrderPushEvent = 'paid' | 'preparing' | 'ready' | 'out_for_delivery' | 'completed' | 'problem'

/** The customer push for each prep status, shared by admin's PATCH and the till's prep steps (Ruling 6). */
export const PREP_PUSH_EVENTS: Partial<Record<PrepStatus, OrderPushEvent>> = {
  preparing: 'preparing',
  ready: 'ready',
  out_for_delivery: 'out_for_delivery',
  completed: 'completed',
}

type PushDeps = Pick<AppDeps, 'sql' | 'push'>
type SubRow = PushTarget & { id: string }

const COPY: Record<OrderPushEvent, (w: string) => { title: string; body: string }> = {
  paid: (w) => ({ title: `${w} · Payment confirmed — we're on it`, body: 'Tap to follow your order.' }),
  preparing: (w) => ({ title: `${w} is being prepared`, body: 'Your order is in the works.' }),
  ready: (w) => ({ title: `${w} is ready for pickup`, body: 'Come on over, it is waiting at the counter.' }),
  out_for_delivery: (w) => ({ title: `${w} is on its way`, body: 'Your rider is heading to you.' }),
  completed: (w) => ({ title: `${w} is complete — enjoy!`, body: 'Thank you for ordering from Kennko.' }),
  problem: (w) => ({ title: `${w} · There's a problem with your order`, body: 'Tap to see what happened.' }),
}

/** Sends to every subscription, deletes the ones the push service says are gone. Never throws. */
async function deliver(deps: PushDeps, subs: SubRow[], payload: PushPayload): Promise<void> {
  const send = deps.push
  if (!send || subs.length === 0) return
  const outcomes = await Promise.all(
    subs.map(async (s) => {
      try {
        return await send(s, payload)
      } catch (err) {
        console.error('push sender threw', err)
        return 'failed' as const
      }
    }),
  )
  const gone = subs.filter((_, i) => outcomes[i] === 'gone').map((s) => s.id)
  const sent = subs.filter((_, i) => outcomes[i] === 'sent').map((s) => s.id)
  if (gone.length > 0) await deps.sql`delete from push_subscriptions where id in ${deps.sql(gone)}`
  if (sent.length > 0) await deps.sql`update push_subscriptions set last_used_at = now() where id in ${deps.sql(sent)}`
}

type OrderRow = { order_code: string; ticket_series: 'C' | 'W'; ticket_number: number; total_centavos: number }
const loadOrder = async (deps: PushDeps, orderId: string) =>
  (
    await deps.sql<OrderRow[]>`
      select order_code, ticket_series, ticket_number, total_centavos from orders where id = ${orderId}`
  )[0]

export async function notifyOrder(deps: PushDeps, orderId: string, event: OrderPushEvent): Promise<void> {
  if (!deps.push) return
  try {
    const order = await loadOrder(deps, orderId)
    if (!order) return
    const subs = await deps.sql<SubRow[]>`
      select s.id, s.endpoint, s.p256dh, s.auth
      from push_order_watch w join push_subscriptions s on s.id = w.subscription_id
      where w.order_id = ${orderId}`
    const copy = COPY[event](ticketLabel(order.ticket_series, order.ticket_number))
    await deliver(deps, subs, { ...copy, url: `/order/${order.order_code}`, tag: `order-${order.order_code}` })
  } catch (err) {
    console.error('order push failed', err)
  }
}

export async function notifyStaffNewOrder(deps: PushDeps, orderId: string): Promise<void> {
  if (!deps.push) return
  try {
    const order = await loadOrder(deps, orderId)
    if (!order) return
    const subs = await deps.sql<SubRow[]>`
      select s.id, s.endpoint, s.p256dh, s.auth
      from push_subscriptions s join staff st on st.id = s.staff_id
      where s.kind = 'staff' and st.is_active`
    const w = ticketLabel(order.ticket_series, order.ticket_number)
    await deliver(deps, subs, {
      title: `New order ${w} · ${formatPesos(order.total_centavos)} — check payment`,
      body: 'A GCash payment is waiting to be checked.',
      url: '/admin/orders?tab=check',
      // One tag per order, so a second new order alerts again instead of silently replacing the first.
      tag: `new-order-${order.order_code}`,
    })
  } catch (err) {
    console.error('staff push failed', err)
  }
}

/** A subscription follows at most this many orders; the oldest order's watch is dropped first. */
export const MAX_WATCHES = 20

/** Adds a watch, then trims the subscription back to its newest MAX_WATCHES orders. */
export async function watchOrder(sql: AppDeps['sql'], subscriptionId: string, orderId: string): Promise<void> {
  await sql`
    insert into push_order_watch (order_id, subscription_id) values (${orderId}, ${subscriptionId})
    on conflict do nothing`
  await trimWatches(sql, [subscriptionId])
}

async function trimWatches(sql: AppDeps['sql'], subscriptionIds: string[]): Promise<void> {
  for (const id of subscriptionIds) {
    await sql`
      delete from push_order_watch
      where subscription_id = ${id} and order_id in (
        select w.order_id from push_order_watch w join orders o on o.id = w.order_id
        where w.subscription_id = ${id}
        order by o.created_at desc, o.id desc
        offset ${MAX_WATCHES})`
  }
}

/** A signed-in customer's other devices follow their new order without another tap. */
export async function watchForAccount(sql: AppDeps['sql'], orderId: string, userId: string): Promise<void> {
  try {
    const subs = await sql<{ id: string }[]>`
      insert into push_order_watch (order_id, subscription_id)
      select ${orderId}, id from push_subscriptions where customer_user_id = ${userId}
      on conflict do nothing
      returning subscription_id as id`
    await trimWatches(sql, subs.map((r) => r.id))
  } catch (err) {
    console.error('could not watch new order for account', err)
  }
}
