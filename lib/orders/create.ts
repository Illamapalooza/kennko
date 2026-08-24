import 'server-only'
import { getAdminClient } from '@/lib/supabase/admin'
import { validateImage } from '@/lib/images/validate'
import { validateCheckout, type CheckoutInput } from './validate'
import { lineTotal, generateOrderCode } from '@/lib/cart/total'
import { normaliseIce, iceSummary, type IceLevel, type IceServe } from '@/lib/cart/ice'
import { ridingDistanceKm, deliveryFeeCentavos } from '@/lib/delivery/distance'
import { verifyPin } from '@/lib/delivery/verify'
import type { DrinkSize } from '@/lib/menu/types'

export type SubmittedLine = {
  menuItemId: string
  size: DrinkSize
  quantity: number
  modifierIds: string[]
  iceLevel: IceLevel | null
  iceServe: IceServe | null
  note?: string
}

export type SubmittedOrder = CheckoutInput & {
  lines: SubmittedLine[]
  note: string
  claimedTotalCentavos: number
  pin?: { lat: number; lng: number; accuracyM: number | null } | null
}

/** Set by the API route from the session, never from the request body. */
export type OrderContext = { customerUserId: string | null }

export type OrderSummaryItem = {
  name: string
  size: string
  quantity: number
  ice: string | null
  note: string | null
}

export type CreateResult =
  | {
      ok: true
      orderCode: string
      items: OrderSummaryItem[]
      subtotalCentavos: number
      deliveryFeeCentavos: number
      totalCentavos: number
    }
  | { ok: false; status: number; code: string; errors: string[] }

const PROOF_BUCKET = 'payment-proofs'

export async function createOrder(
  submitted: SubmittedOrder,
  proof: File,
  context: OrderContext = { customerUserId: null },
): Promise<CreateResult> {
  const problems = validateCheckout(submitted)
  if (problems.length > 0) {
    return { ok: false, status: 400, code: 'INVALID', errors: problems }
  }

  if (submitted.lines.length === 0) {
    return { ok: false, status: 400, code: 'EMPTY_CART', errors: ['Your cart is empty.'] }
  }

  const bytes = new Uint8Array(await proof.arrayBuffer())
  const image = validateImage(bytes, proof.size)
  if (!image.ok) {
    return { ok: false, status: 400, code: 'BAD_PROOF', errors: [image.error] }
  }

  const db = getAdminClient()

  // ---- Reprice from the database. The client total is never trusted. ----
  const itemIds = [...new Set(submitted.lines.map((l) => l.menuItemId))]
  const modifierIds = [...new Set(submitted.lines.flatMap((l) => l.modifierIds))]

  const { data: items, error: itemsError } = await db
    .from('menu_items')
    .select('id, name, is_available, is_archived, menu_item_prices ( size, price_centavos )')
    .in('id', itemIds)
  if (itemsError) {
    return { ok: false, status: 500, code: 'LOOKUP_FAILED', errors: [itemsError.message] }
  }

  const modifiers = modifierIds.length
    ? (
        await db
          .from('modifiers')
          .select('id, name, price_centavos, is_available')
          .in('id', modifierIds)
      ).data ?? []
    : []

  const priced: {
    line: SubmittedLine
    name: string
    basePrice: number
    mods: { id: string; name: string; priceCentavos: number }[]
    total: number
    ice: { level: IceLevel | null; serve: IceServe | null }
  }[] = []

  for (const line of submitted.lines) {
    const item = items?.find((i) => i.id === line.menuItemId)
    if (!item || item.is_archived || !item.is_available) {
      return {
        ok: false,
        status: 409,
        code: 'ITEM_UNAVAILABLE',
        errors: ['One of the drinks in your cart is no longer available.'],
      }
    }

    const price = (item.menu_item_prices ?? []).find(
      (p: { size: string }) => p.size === line.size,
    )
    if (!price) {
      return {
        ok: false,
        status: 409,
        code: 'SIZE_UNAVAILABLE',
        errors: [`${item.name} is not offered in size ${line.size}.`],
      }
    }

    const mods = line.modifierIds.map((id) => {
      const m = modifiers.find((x) => x.id === id)
      return m && m.is_available
        ? { id: m.id, name: m.name, priceCentavos: m.price_centavos }
        : null
    })
    if (mods.some((m) => m === null)) {
      return {
        ok: false,
        status: 409,
        code: 'MODIFIER_UNAVAILABLE',
        errors: ['One of the add-ons you chose is no longer available.'],
      }
    }
    const resolvedMods = mods as { id: string; name: string; priceCentavos: number }[]

    let total: number
    try {
      total = lineTotal({
        basePriceCentavos: price.price_centavos,
        modifiers: resolvedMods,
        quantity: line.quantity,
      })
    } catch (cause) {
      return {
        ok: false,
        status: 400,
        code: 'BAD_QUANTITY',
        errors: [cause instanceof Error ? cause.message : 'Invalid quantity'],
      }
    }

    // Normalised server-side too: a crafted request cannot attach an ice
    // instruction to a hot drink, and the CHECK constraint backs this up.
    const ice = normaliseIce(line.size, line.iceLevel, line.iceServe)

    priced.push({
      line,
      name: item.name,
      basePrice: price.price_centavos,
      mods: resolvedMods,
      total,
      ice,
    })
  }

  const subtotal = priced.reduce((sum, p) => sum + p.total, 0)

  // ---- Delivery fee comes from the zone row, never from the request. ----
  let feeCentavos = 0
  let zoneId: string | null = null
  let distanceKm: number | null = null
  let pin: { lat: number; lng: number; accuracyM: number | null } | null = null

  if (submitted.fulfilment === 'delivery') {
    const { data: zone } = await db
      .from('delivery_zones')
      .select('id, is_active, is_home, latitude, longitude, fee_override_centavos')
      .eq('barangay', submitted.barangay.trim())
      .maybeSingle()

    if (!zone || !zone.is_active) {
      return {
        ok: false,
        status: 409,
        code: 'OUTSIDE_SERVICE_AREA',
        errors: [`Sorry, Kennko does not deliver to ${submitted.barangay} yet.`],
      }
    }

    if (zone.fee_override_centavos !== null) {
      feeCentavos = zone.fee_override_centavos
    } else if (zone.latitude === null || zone.longitude === null) {
      return {
        ok: false,
        status: 409,
        code: 'ZONE_NOT_LOCATED',
        errors: [
          `We cannot work out the delivery fee for ${submitted.barangay} yet. ` +
            'Please choose pickup, or message the cafe.',
        ],
      }
    } else {
      const centre = { lat: Number(zone.latitude), lng: Number(zone.longitude) }

      // The pin is client-supplied and sets the price, so it is only trusted
      // when it agrees with the barangay -- which is not client-supplied. A
      // rejected pin falls back to the barangay centre rather than failing the
      // order, except when the customer is plainly claiming the wrong place.
      const check = verifyPin(submitted.pin ?? null, centre)

      if (!check.ok && check.reason === 'inconsistent') {
        return {
          ok: false,
          status: 409,
          code: 'PIN_MISMATCH',
          errors: [check.message],
        }
      }

      const target = check.ok ? check.pin : centre
      distanceKm = ridingDistanceKm(target)
      feeCentavos = deliveryFeeCentavos(distanceKm, zone.is_home)
      if (check.ok) pin = { ...check.pin, accuracyM: submitted.pin?.accuracyM ?? null }
    }

    zoneId = zone.id
  }

  const total = subtotal + feeCentavos

  if (total !== submitted.claimedTotalCentavos) {
    return {
      ok: false,
      status: 409,
      code: 'PRICE_CHANGED',
      errors: ['Prices changed while you were ordering. Please review your cart.'],
    }
  }

  // ---- Store the proof, then the order. ----
  const orderCode = generateOrderCode()
  const proofPath = `proofs/${orderCode}/${crypto.randomUUID()}.${image.extension}`

  const { error: uploadError } = await db.storage
    .from(PROOF_BUCKET)
    .upload(proofPath, bytes, { contentType: image.contentType, upsert: false })
  if (uploadError) {
    return { ok: false, status: 500, code: 'UPLOAD_FAILED', errors: [uploadError.message] }
  }

  const { data: order, error: orderError } = await db
    .from('orders')
    .insert({
      order_code: orderCode,
      customer_name: submitted.name.trim(),
      customer_phone: submitted.phone.replace(/[\s-]/g, ''),
      customer_email: submitted.email.trim().toLowerCase(),
      fulfilment: submitted.fulfilment,
      delivery_address:
        submitted.fulfilment === 'delivery' ? submitted.address.trim() : null,
      delivery_barangay:
        submitted.fulfilment === 'delivery' ? submitted.barangay.trim() : null,
      delivery_zone_id: zoneId,
      fulfil_at: submitted.fulfilAt,
      subtotal_centavos: subtotal,
      delivery_fee_centavos: feeCentavos,
      total_centavos: total,
      gcash_reference: submitted.gcashReference.trim().toUpperCase(),
      payment_proof_path: proofPath,
      customer_note: submitted.note.trim() || null,
      customer_user_id: context.customerUserId,
      delivery_lat: pin?.lat ?? null,
      delivery_lng: pin?.lng ?? null,
      delivery_accuracy_m: pin?.accuracyM ?? null,
      delivery_distance_km: distanceKm !== null ? Number(distanceKm.toFixed(2)) : null,
    })
    .select('id')
    .single()

  if (orderError || !order) {
    // Do not leave a billed orphan behind a failed insert.
    await db.storage.from(PROOF_BUCKET).remove([proofPath])
    return {
      ok: false,
      status: 500,
      code: 'ORDER_FAILED',
      errors: [orderError?.message ?? 'Could not save the order'],
    }
  }

  for (const entry of priced) {
    const { data: item, error: itemError } = await db
      .from('order_items')
      .insert({
        order_id: order.id,
        menu_item_id: entry.line.menuItemId,
        name_snapshot: entry.name,
        size: entry.line.size,
        base_price_centavos: entry.basePrice,
        quantity: entry.line.quantity,
        line_total_centavos: entry.total,
        ice_level: entry.ice.level,
        ice_serve: entry.ice.serve,
        item_note: entry.line.note?.trim().slice(0, 200) || null,
      })
      .select('id')
      .single()

    if (itemError || !item) {
      await db.from('orders').delete().eq('id', order.id)
      await db.storage.from(PROOF_BUCKET).remove([proofPath])
      return {
        ok: false,
        status: 500,
        code: 'ORDER_FAILED',
        errors: [itemError?.message ?? 'Could not save the order lines'],
      }
    }

    if (entry.mods.length > 0) {
      await db.from('order_item_modifiers').insert(
        entry.mods.map((m) => ({
          order_item_id: item.id,
          modifier_id: m.id,
          name_snapshot: m.name,
          price_centavos: m.priceCentavos,
        })),
      )
    }
  }

  return {
    ok: true,
    orderCode,
    items: priced.map((p) => ({
      name: p.name,
      size: p.line.size,
      quantity: p.line.quantity,
      ice: iceSummary(p.ice.level, p.ice.serve),
      note: p.line.note?.trim().slice(0, 200) || null,
    })),
    subtotalCentavos: subtotal,
    deliveryFeeCentavos: feeCentavos,
    totalCentavos: total,
  }
}
