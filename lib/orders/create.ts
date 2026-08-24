import 'server-only'
import { getAdminClient } from '@/lib/supabase/admin'
import { validateImage } from '@/lib/images/validate'
import { validateCheckout, type CheckoutInput } from './validate'
import { lineTotal, generateOrderCode } from '@/lib/cart/total'
import type { DrinkSize } from '@/lib/menu/types'

export type SubmittedLine = {
  menuItemId: string
  size: DrinkSize
  quantity: number
  modifierIds: string[]
}

export type SubmittedOrder = CheckoutInput & {
  lines: SubmittedLine[]
  note: string
  claimedTotalCentavos: number
}

export type OrderSummaryItem = { name: string; size: string; quantity: number }

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

    priced.push({
      line,
      name: item.name,
      basePrice: price.price_centavos,
      mods: resolvedMods,
      total,
    })
  }

  const subtotal = priced.reduce((sum, p) => sum + p.total, 0)

  // ---- Delivery fee comes from the zone row, never from the request. ----
  let feeCentavos = 0
  let zoneId: string | null = null

  if (submitted.fulfilment === 'delivery') {
    const { data: zone } = await db
      .from('delivery_zones')
      .select('id, fee_centavos, is_active')
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
    feeCentavos = zone.fee_centavos
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
    })),
    subtotalCentavos: subtotal,
    deliveryFeeCentavos: feeCentavos,
    totalCentavos: total,
  }
}
