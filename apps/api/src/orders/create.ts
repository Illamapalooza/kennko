import {
  deliveryFeeCentavos,
  iceSummary,
  manilaDay,
  parseManilaDateTime,
  priceOnlineOrder,
  ridingDistanceKm,
  ticketLabel,
  validateCheckout,
  verifyPin,
  type CheckoutInput,
  type CheckoutLine,
  type MenuSnapshot,
  type PricedOnlineOrder,
} from '@kennko/core'
import type postgres from 'postgres'
import type { AppDeps } from '../create-app.js'
import { readLatestMenu } from '../menu/read.js'
import { validateImage } from './image.js'
import { notifyStaffNewOrder, watchForAccount } from '../push/notify.js'
import { nextTicket } from './tickets.js'

/** What the website posts as the `order` field (today's `SubmittedOrder`). */
export type SubmittedOrder = CheckoutInput & {
  lines: CheckoutLine[]
  note: string
  claimedTotalCentavos: number
  pin?: { lat: number; lng: number; accuracyM: number | null } | null
}

export type CreateOrderInput = {
  order: SubmittedOrder
  proof: { bytes: Uint8Array; contentType: string }
  /** From a verified bearer token, never from the body. */
  userId: string | null
}

export type OrderSummaryItem = {
  name: string
  variantLabel: string
  quantity: number
  ice: string | null
  note: string | null
}

export type CreateOrderResult =
  | {
      ok: true
      orderId: string
      orderCode: string
      ticket: string
      items: OrderSummaryItem[]
      subtotalCentavos: number
      deliveryFeeCentavos: number
      totalCentavos: number
    }
  | { ok: false; status: 400 | 409 | 500 | 503; code: string; errors: string[] }

type Failure = Extract<CreateOrderResult, { ok: false }>

export type CreateOrderDeps = Pick<AppDeps, 'sql' | 'proofs' | 'now' | 'orderCode' | 'push'>

// Excludes 0/O, 1/I/L, B/8, S/5, 2/Z, G/6 -- customers read these aloud.
const CODE_ALPHABET = 'ACDEFHJKLMNPRTUVWXY34679'
const MAX_CODE_ATTEMPTS = 3

/** `KNK-` + 6 characters (Ruling 5). Existing 4-character codes stay valid. */
export function generateOrderCode(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return `KNK-${Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')}`
}

const fail = (status: Failure['status'], code: string, error: string): Failure => ({
  ok: false,
  status,
  code,
  errors: [error],
})

type Delivery = {
  feeCentavos: number
  zoneId: string | null
  distanceKm: number | null
  pin: { lat: number; lng: number; accuracyM: number | null } | null
}

/** Delivery fee comes from the zone row, never from the request. */
async function resolveDelivery(sql: postgres.Sql, order: SubmittedOrder): Promise<Delivery | Failure> {
  if (order.fulfilment !== 'delivery') return { feeCentavos: 0, zoneId: null, distanceKm: null, pin: null }

  const [zone] = await sql<
    {
      id: string
      is_active: boolean
      is_home: boolean
      latitude: string | null
      longitude: string | null
      fee_override_centavos: number | null
    }[]
  >`select id, is_active, is_home, latitude, longitude, fee_override_centavos
    from delivery_zones where barangay = ${order.barangay.trim()}`

  if (!zone || !zone.is_active) {
    return fail(409, 'OUTSIDE_SERVICE_AREA', `Sorry, Kennko does not deliver to ${order.barangay} yet.`)
  }

  if (zone.fee_override_centavos !== null) {
    return { feeCentavos: zone.fee_override_centavos, zoneId: zone.id, distanceKm: null, pin: null }
  }
  if (zone.latitude === null || zone.longitude === null) {
    return fail(
      409,
      'ZONE_NOT_LOCATED',
      `We cannot work out the delivery fee for ${order.barangay} yet. ` + 'Please choose pickup, or message the cafe.',
    )
  }

  const centre = { lat: Number(zone.latitude), lng: Number(zone.longitude) }
  // The pin is client-supplied and sets the price, so it is only trusted when it agrees with the
  // barangay. A rejected pin falls back to the barangay centre, except when it plainly claims the
  // wrong place.
  const check = verifyPin(order.pin ?? null, centre)
  if (!check.ok && check.reason === 'inconsistent') return fail(409, 'PIN_MISMATCH', check.message)

  const target = check.ok ? check.pin : centre
  const distanceKm = ridingDistanceKm(target)
  return {
    feeCentavos: deliveryFeeCentavos(distanceKm, zone.is_home),
    zoneId: zone.id,
    distanceKm,
    pin: check.ok ? { ...check.pin, accuracyM: order.pin?.accuracyM ?? null } : null,
  }
}

// Bounds at the API boundary, measured on the submitted text.
const LIMITS: [label: string, max: number, pick: (o: SubmittedOrder) => string][] = [
  ['Name', 100, (o) => o.name],
  ['Email', 200, (o) => o.email],
  ['Mobile number', 30, (o) => o.phone],
  ['Delivery address', 300, (o) => o.address],
  ['Barangay', 100, (o) => o.barangay],
  ['Order note', 500, (o) => o.note],
  ['GCash reference', 40, (o) => o.gcashReference],
]
const LINE_NOTE_MAX = 200

function lengthProblems(order: SubmittedOrder): string[] {
  const problems = LIMITS.filter(([, max, pick]) => pick(order).length > max).map(
    ([label, max]) => `${label} must be ${max} characters or fewer.`,
  )
  if (order.lines.some((l) => (l.note ?? '').length > LINE_NOTE_MAX)) {
    problems.push(`Drink note must be ${LINE_NOTE_MAX} characters or fewer.`)
  }
  return problems
}

function isOrderCodeCollision(err: unknown): boolean {
  const e = err as { code?: string; constraint_name?: string }
  return e?.code === '23505' && e.constraint_name === 'orders_order_code_key'
}

async function removeQuietly(deps: CreateOrderDeps, path: string): Promise<void> {
  try {
    await deps.proofs.remove(path)
  } catch (err) {
    console.error(`could not remove payment proof ${path}`, err)
  }
}

export async function createOnlineOrder(deps: CreateOrderDeps, input: CreateOrderInput): Promise<CreateOrderResult> {
  const { order, proof, userId } = input
  const now = deps.now()

  const problems = [...lengthProblems(order), ...validateCheckout(order, now)]
  if (problems.length > 0) return { ok: false, status: 400, code: 'INVALID', errors: problems }

  if (order.lines.length === 0) return fail(400, 'EMPTY_CART', 'Your cart is empty.')

  const image = validateImage(proof.bytes, proof.bytes.length)
  if (!image.ok) return fail(400, 'BAD_PROOF', image.error)

  // ---- Reprice from the published menu with live sold-out marks (Ruling P1). ----
  let snapshot: MenuSnapshot | null
  try {
    snapshot = (await readLatestMenu(deps.sql))?.snapshot ?? null
  } catch (err) {
    console.error('menu read failed', err)
    snapshot = null
  }
  if (!snapshot) {
    return fail(503, 'MENU_UNAVAILABLE', "The menu can't load right now. Please try again in a minute.")
  }

  let priced: PricedOnlineOrder
  try {
    priced = priceOnlineOrder(snapshot, order.lines)
  } catch (err) {
    const code = (err as { code?: string }).code
    const message = err instanceof Error ? err.message : 'Invalid order'
    if (code === 'ITEM_UNAVAILABLE' || code === 'SIZE_UNAVAILABLE' || code === 'MODIFIER_UNAVAILABLE') {
      return fail(409, code, message)
    }
    if (code === 'BAD_QUANTITY' || code === 'EMPTY_CART') return fail(400, code, message)
    console.error('order pricing failed unexpectedly', err)
    return fail(500, 'ORDER_FAILED', 'Could not save the order')
  }

  let delivery: Delivery | Failure
  try {
    delivery = await resolveDelivery(deps.sql, order)
  } catch (err) {
    console.error('delivery zone lookup failed', err)
    return fail(503, 'ORDERING_UNAVAILABLE', 'Ordering is unavailable right now. Please try again in a few minutes.')
  }
  if ('ok' in delivery) return delivery

  const subtotal = priced.subtotalCentavos
  const total = subtotal + delivery.feeCentavos
  if (total !== order.claimedTotalCentavos) {
    return fail(409, 'PRICE_CHANGED', 'Prices changed while you were ordering. Please review your cart.')
  }

  // ---- Store the proof, then the order in one transaction. ----
  const businessDay = manilaDay(now.getTime())
  // validateCheckout already refused an unparseable time; a datetime-local value has no offset and is Manila time.
  const fulfilAt = parseManilaDateTime(order.fulfilAt)!.toISOString()
  const makeCode = deps.orderCode ?? generateOrderCode
  const isDelivery = order.fulfilment === 'delivery'

  for (let attempt = 1; ; attempt++) {
    const orderCode = makeCode()
    const proofPath = `proofs/${orderCode}/${crypto.randomUUID()}.${image.extension}`

    try {
      await deps.proofs.upload(proofPath, proof.bytes, image.contentType)
    } catch (err) {
      console.error('payment proof upload failed', err)
      // The object may have landed even though the call failed.
      await removeQuietly(deps, proofPath)
      return fail(500, 'UPLOAD_FAILED', 'We could not save your payment screenshot. Please try again.')
    }

    try {
      const saved = (await deps.sql.begin(async (tx) => {
        const ticketNumber = await nextTicket(tx, businessDay, 'W')
        const [row] = await tx<{ id: string }[]>`
          insert into orders (
            channel, order_code, fulfilment, prep_status, payment_status,
            business_day, ticket_series, ticket_number, menu_version,
            customer_name, customer_phone, customer_email, customer_user_id, customer_note,
            delivery_address, delivery_barangay, delivery_zone_id,
            delivery_lat, delivery_lng, delivery_accuracy_m, delivery_distance_km,
            fulfil_at, subtotal_centavos, delivery_fee_centavos, total_centavos
          ) values (
            'online', ${orderCode}, ${order.fulfilment}, 'placed', 'pending_verification',
            ${businessDay}, 'W', ${ticketNumber}, ${snapshot.version},
            ${order.name.trim()}, ${order.phone.replace(/[\s-]/g, '')}, ${order.email.trim().toLowerCase()},
            ${userId}, ${order.note.trim() || null},
            ${isDelivery ? order.address.trim() : null}, ${isDelivery ? order.barangay.trim() : null},
            ${delivery.zoneId},
            ${delivery.pin?.lat ?? null}, ${delivery.pin?.lng ?? null}, ${delivery.pin?.accuracyM ?? null},
            ${delivery.distanceKm !== null ? Number(delivery.distanceKm.toFixed(2)) : null},
            ${fulfilAt}, ${subtotal}, ${delivery.feeCentavos}, ${total}
          ) returning id`
        const orderId = row!.id

        for (const line of priced.lines) {
          const [lineRow] = await tx<{ id: string }[]>`
            insert into order_lines (
              order_id, item_id, variant_id, item_name, variant_code, variant_label,
              unit_price_centavos, quantity, line_total_centavos, ice_level, ice_serve, note
            ) values (
              ${orderId}, ${line.itemId}, ${line.variantId}, ${line.itemName}, ${line.variantCode},
              ${line.variantLabel}, ${line.unitPriceCentavos}, ${line.quantity}, ${line.lineTotalCentavos},
              ${line.iceLevel}, ${line.iceServe}, ${line.note}
            ) returning id`
          for (const opt of line.options) {
            await tx`
              insert into order_line_options (line_id, option_id, group_name, option_name, price_centavos)
              values (${lineRow!.id}, ${opt.optionId}, ${opt.groupName}, ${opt.optionName}, ${opt.priceCentavos})`
          }
        }

        await tx`
          insert into payments (order_id, method, amount_centavos, reference, proof_path, status)
          values (${orderId}, 'gcash', ${total}, ${order.gcashReference.trim().toUpperCase()}, ${proofPath},
                  'pending_verification')`
        await tx`insert into order_events (order_id, kind, to_value) values (${orderId}, 'created', 'placed')`

        return { orderId, ticketNumber }
      })) as { orderId: string; ticketNumber: number }

      // After commit. Both helpers swallow their own errors, so the order is never failed by push.
      if (userId) await watchForAccount(deps.sql, saved.orderId, userId)
      await notifyStaffNewOrder(deps, saved.orderId)

      return {
        ok: true,
        orderId: saved.orderId,
        orderCode,
        ticket: ticketLabel('W', saved.ticketNumber),
        items: priced.lines.map((l) => ({
          name: l.itemName,
          variantLabel: l.variantLabel,
          quantity: l.quantity,
          ice: iceSummary(l.iceLevel, l.iceServe),
          note: l.note,
        })),
        subtotalCentavos: subtotal,
        deliveryFeeCentavos: delivery.feeCentavos,
        totalCentavos: total,
      }
    } catch (err) {
      // Do not leave a billed orphan behind a failed insert.
      await removeQuietly(deps, proofPath)
      if (isOrderCodeCollision(err) && attempt < MAX_CODE_ATTEMPTS) continue
      console.error('order insert failed', err)
      return fail(500, 'ORDER_FAILED', 'Could not save the order')
    }
  }
}
