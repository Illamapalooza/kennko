import { manilaDay, repriceCounterOrder, SIZE_LABELS, type CounterOrderPayload, type MenuSnapshot, type SyncEvent } from '@kennko/core'
import type postgres from 'postgres'
import { readMenuVersion } from '../menu/read.js'
import type { Applied } from './apply.js'

type Tx = postgres.TransactionSql
type EventOf<K extends SyncEvent['kind']> = Extract<SyncEvent, { kind: K }>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY_MS = 86_400_000

const applied = (reason: string | null = null): Applied => ({ result: 'applied', reason, flags: [] })
const held = (reason: string): Applied => ({ result: 'held', reason, flags: [] })
const flagged = (reason: string, flags: string[] = []): Applied => ({ result: 'flagged', reason, flags })

/**
 * The arithmetic every stored order must satisfy (Ruling 4). The table checks cover the order
 * totals and the cash payment; the line check keeps a line from contradicting its own prices.
 */
export function totalsAreConsistent(p: CounterOrderPayload): boolean {
  if (p.discountCentavos > p.subtotalCentavos) return false
  if (p.totalCentavos !== p.subtotalCentavos - p.discountCentavos) return false
  const { method, tenderedCentavos, changeCentavos } = p.payment
  if (method === 'cash' && tenderedCentavos !== null && changeCentavos !== null && tenderedCentavos - changeCentavos !== p.totalCentavos) {
    return false
  }
  return p.lines.every(
    (l) => l.lineTotalCentavos === (l.basePriceCentavos + l.modifiers.reduce((sum, m) => sum + m.priceCentavos, 0)) * l.quantity,
  )
}

/** The ids among `ids` that are uuids present in `table`. */
async function existing(tx: Tx, table: 'menu_items' | 'menu_variants' | 'options', ids: (string | undefined)[]): Promise<Set<string>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== undefined && UUID.test(id)))]
  if (wanted.length === 0) return new Set()
  const rows = await tx<{ id: string }[]>`select id from ${tx(table)} where id = any(${wanted}::uuid[])`
  return new Set(rows.map((r) => r.id))
}

/**
 * A sale rung at the till. Stored as sent whenever the arithmetic holds; anything that needs a
 * human's eye is flagged, never refused. Flags: `unknown_version` (version null or not published;
 * stored null), `reprice_mismatch`, `ticket_duplicate`, `clock_skew`.
 */
export async function applyOrderCreated(
  tx: Tx,
  deviceId: string,
  event: EventOf<'order.created'>,
  staffId: string | null,
  now: Date,
): Promise<Applied> {
  const p = event.payload
  const [shift] = await tx<{ opened_by_staff: string | null }[]>`select opened_by_staff from shifts where id = ${p.shiftId}`
  if (!shift) return held('shift_unknown')
  if (!totalsAreConsistent(p)) return held('invalid: totals')
  // An order id already stored (sent again under a new event id) is not written twice.
  const [already] = await tx<{ subtotal_centavos: number; discount_centavos: number; total_centavos: number }[]>`
    select subtotal_centavos, discount_centavos, total_centavos from orders where id = ${p.orderId}`
  if (already) {
    const same =
      already.subtotal_centavos === p.subtotalCentavos &&
      already.discount_centavos === p.discountCentavos &&
      already.total_centavos === p.totalCentavos
    return same ? applied('already_recorded') : flagged('already_recorded_differs')
  }
  // A payment id is the till's; one already on another order would fail the insert on every retry.
  const [payTaken] = await tx`select 1 from payments where id = ${p.payment.id}`
  if (payTaken) return held('invalid: payment_id_taken')

  const flags: string[] = []
  const snapshot: MenuSnapshot | null = p.menuVersion === null ? null : await readMenuVersion(tx, p.menuVersion)
  // With nothing to re-price against, at least the subtotal must be the sum of the lines.
  if (!snapshot && p.subtotalCentavos !== p.lines.reduce((sum, l) => sum + l.lineTotalCentavos, 0)) return held('invalid: totals')
  if (!snapshot) flags.push('unknown_version')
  else if (!repriceCounterOrder(snapshot, p).matches) flags.push('reprice_mismatch')
  const [dup] = await tx`
    select 1 from orders
    where device_id = ${deviceId} and business_day = ${p.businessDay} and ticket_series = 'C' and ticket_number = ${p.ticketNumber}
    limit 1`
  if (dup) flags.push('ticket_duplicate')
  if (Math.abs(Date.parse(p.businessDay) - Date.parse(manilaDay(now.getTime()))) > DAY_MS) flags.push('clock_skew')

  const items = new Map((snapshot?.categories ?? []).flatMap((c) => c.items).map((i) => [i.id, i]))
  const groups = snapshot?.optionGroups ?? []
  const variantOf = (line: CounterOrderPayload['lines'][number]) =>
    items.get(line.menuItemId)?.variants.find((v) => v.code === line.size)
  const groupNameOf = (itemId: string, optionId: string) => {
    const item = items.get(itemId)
    const group = groups.find((g) => (item ? item.optionGroupIds.includes(g.id) : true) && g.options.some((o) => o.id === optionId))
    return group?.name ?? ''
  }
  const knownItems = await existing(tx, 'menu_items', p.lines.map((l) => l.menuItemId))
  const knownVariants = await existing(tx, 'menu_variants', p.lines.map((l) => variantOf(l)?.id))
  const knownOptions = await existing(tx, 'options', p.lines.flatMap((l) => l.modifiers.map((m) => m.id)))
  // Without a snapshot, a known item's variant is found by its size code.
  const variantsBySize = new Map<string, string>()
  if (!snapshot && knownItems.size > 0) {
    const rows = await tx<{ id: string; item_id: string; code: string }[]>`
      select id, item_id, code from menu_variants where item_id = any(${[...knownItems]}::uuid[])`
    for (const r of rows) variantsBySize.set(`${r.item_id}|${r.code}`, r.id)
  }

  const discount = p.discount
  await tx`
    insert into orders (
      id, channel, fulfilment, prep_status, payment_status, business_day, ticket_series, ticket_number,
      menu_version, customer_name, subtotal_centavos, discount_centavos, total_centavos,
      discount_label, discount_kind, discount_value, flags, device_id, shift_id, opened_by_staff,
      created_at, received_at, updated_at
    ) values (
      ${p.orderId}, 'counter', ${p.fulfilment}, 'placed', 'paid', ${p.businessDay}, 'C', ${p.ticketNumber},
      ${snapshot ? snapshot.version : null}, ${p.customerName}, ${p.subtotalCentavos}, ${p.discountCentavos}, ${p.totalCentavos},
      ${discount?.label ?? null}, ${discount?.kind ?? null}, ${discount?.value ?? null}, ${flags}::text[],
      ${deviceId}, ${p.shiftId}, ${shift.opened_by_staff},
      ${event.occurredAt}, ${now}, ${now}
    )`

  for (const line of p.lines) {
    const itemId = knownItems.has(line.menuItemId) ? line.menuItemId : null
    const variant = variantOf(line)
    const variantId =
      variant && knownVariants.has(variant.id) ? variant.id : itemId ? (variantsBySize.get(`${itemId}|${line.size}`) ?? null) : null
    const [row] = await tx<{ id: string }[]>`
      insert into order_lines (
        order_id, item_id, variant_id, item_name, variant_code, variant_label, unit_price_centavos,
        quantity, line_total_centavos, ice_level, ice_serve, note, created_at
      ) values (
        ${p.orderId}, ${itemId}, ${variantId}, ${line.name}, ${line.size}, ${variant?.label ?? SIZE_LABELS[line.size]},
        ${line.basePriceCentavos}, ${line.quantity}, ${line.lineTotalCentavos}, ${line.iceLevel}, ${line.iceServe},
        ${line.note}, ${event.occurredAt}
      ) returning id`
    for (const m of line.modifiers) {
      await tx`
        insert into order_line_options (line_id, option_id, group_name, option_name, price_centavos)
        values (${row!.id}, ${knownOptions.has(m.id) ? m.id : null}, ${groupNameOf(line.menuItemId, m.id)}, ${m.name},
                ${m.priceCentavos})`
    }
  }

  const pay = p.payment
  await tx`
    insert into payments (id, order_id, method, amount_centavos, tendered_centavos, change_centavos, reference,
      status, device_id, recorded_at)
    values (${pay.id}, ${p.orderId}, ${pay.method}, ${p.totalCentavos}, ${pay.tenderedCentavos}, ${pay.changeCentavos},
      ${pay.reference}, 'recorded', ${deviceId}, ${event.occurredAt})`

  const reason = flags.length > 0 ? flags.join(',') : null
  await tx`
    insert into order_events (id, device_id, order_id, kind, to_value, staff_id, occurred_at, received_at, result, reason)
    values (${event.id}, ${deviceId}, ${p.orderId}, 'created', 'placed', ${staffId}, ${event.occurredAt}, ${now},
      ${reason ? 'flagged' : 'applied'}, ${reason})`

  return reason ? flagged(reason, flags) : applied()
}

type OrderState = { channel: string; prep_status: string }

/**
 * An order event already stored under this id. The receipt is keyed (device_id, id), but a re-paired
 * till resends its outbox under a new device id; order_events is keyed by id alone, so the second
 * insert would fail on every retry and block the order. Such an event is answered as recorded.
 */
async function eventRecorded(tx: Tx, eventId: string): Promise<boolean> {
  const [row] = await tx`select 1 from order_events where id = ${eventId}`
  return row !== undefined
}

async function loadOrder(tx: Tx, orderId: string): Promise<OrderState | undefined> {
  // Locked so a prep change and a cancel for the same order (or an admin action) cannot interleave.
  const [row] = await tx<OrderState[]>`select channel, prep_status from orders where id = ${orderId} for update`
  return row
}

/** Counter prep changes apply in the order received (Ruling 7); a cancelled order stays cancelled. */
export async function applyPrepStatus(
  tx: Tx,
  deviceId: string,
  event: EventOf<'order.prep_status'>,
  staffId: string | null,
  now: Date,
): Promise<Applied> {
  const { orderId, to } = event.payload
  if (await eventRecorded(tx, event.id)) return applied('already_recorded')
  const order = await loadOrder(tx, orderId)
  if (!order) return held('order_unknown')
  // Online prep belongs to admin until Plan 5.
  if (order.channel !== 'counter') return flagged('online_order')
  if (order.prep_status === 'cancelled') return applied('already_cancelled')
  // Voids come through order.cancelled; a counter order is never out for delivery.
  if (to === 'cancelled' || to === 'out_for_delivery') return flagged('not_for_counter')
  await tx`update orders set prep_status = ${to}, updated_at = ${now} where id = ${orderId}`
  await tx`
    insert into order_events (id, device_id, order_id, kind, from_value, to_value, staff_id, occurred_at, received_at)
    values (${event.id}, ${deviceId}, ${orderId}, 'prep_status', ${order.prep_status}, ${to}, ${staffId},
      ${event.occurredAt}, ${now})`
  return applied()
}

/** A void at the till: the order is cancelled and its live payment refunded. */
export async function applyCancelled(
  tx: Tx,
  deviceId: string,
  event: EventOf<'order.cancelled'>,
  staffId: string | null,
  now: Date,
): Promise<Applied> {
  const { orderId, reason } = event.payload
  if (await eventRecorded(tx, event.id)) return applied('already_recorded')
  const order = await loadOrder(tx, orderId)
  if (!order) return held('order_unknown')
  if (order.channel !== 'counter') return flagged('online_order')
  if (order.prep_status === 'cancelled') return applied('already_cancelled')
  await tx`
    update orders set prep_status = 'cancelled', payment_status = 'refunded', cancelled_at = ${event.occurredAt},
      cancelled_by_staff = ${staffId}, cancel_reason = ${reason}, updated_at = ${now}
    where id = ${orderId}`
  await tx`update payments set status = 'refunded' where order_id = ${orderId} and status <> 'rejected'`
  await tx`
    insert into order_events (id, device_id, order_id, kind, from_value, to_value, staff_id, occurred_at, received_at, reason)
    values (${event.id}, ${deviceId}, ${orderId}, 'cancelled', ${order.prep_status}, 'cancelled', ${staffId},
      ${event.occurredAt}, ${now}, ${reason})`
  return applied()
}
