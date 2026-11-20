import 'server-only'
import type { PublicReceiptView } from '@kennko/core'
import { publicFetch } from '@/lib/api/client'
import type { ReceiptOrder, ShopSettings } from './receipt'

export const FALLBACK_SETTINGS: ShopSettings = {
  displayName: 'Kennko Coffee',
  registeredName: null,
  tin: null,
  address: 'CT. Montalban St., Villa Kananga, Butuan City, Philippines 8600',
  phone: null,
  facebookUrl: null,
  receiptFooter: 'Ask for your official receipt at the counter.',
}

/** `GET /v1/orders/by-code/:code/receipt`. 404 is null; any other failure is logged and thrown. */
async function fetchReceipt(code: string): Promise<PublicReceiptView | null> {
  let res: Response
  try {
    res = await publicFetch(`/v1/orders/by-code/${encodeURIComponent(code)}/receipt`)
  } catch (cause) {
    console.error('[receipt] could not load order', code, cause)
    throw new Error(`Could not load the receipt for ${code}`)
  }
  if (res.status === 404) return null
  if (!res.ok) {
    console.error('[receipt] could not load order', code, res.status)
    throw new Error(`Could not load the receipt for ${code}`)
  }
  return (await res.json()) as PublicReceiptView
}

/**
 * The API's PUBLIC receipt as a ReceiptOrder: first name only, barangay only (no street), and the
 * GCash reference already masked. `buildReceipt(…, 'public')` then renders exactly as before, since
 * re-masking `••••1234` and re-splitting a first name change nothing. The emailed receipt overrides
 * customerName, deliveryAddress and reference from the staff-only payment notice.
 */
function toReceiptOrder(o: PublicReceiptView['order']): ReceiptOrder {
  return {
    orderCode: o.orderCode,
    ticket: o.ticket,
    customerName: o.customerFirstName || 'Customer',
    fulfilment: o.fulfilment,
    deliveryAddress: null,
    deliveryBarangay: o.deliveryBarangay,
    paidAt: o.payment?.verifiedAt ?? null,
    paymentStatus: o.paymentStatus,
    prepStatus: o.prepStatus,
    cancelledAt: o.cancelledAt,
    reference: o.payment?.referenceMasked ?? null,
    subtotalCentavos: o.subtotalCentavos,
    discountCentavos: o.discountCentavos,
    deliveryFeeCentavos: o.deliveryFeeCentavos,
    totalCentavos: o.totalCentavos,
    lines: o.lines.map((l) => ({
      itemName: l.itemName,
      variantLabel: l.variantLabel,
      quantity: l.quantity,
      unitPriceCentavos: l.unitPriceCentavos,
      lineTotalCentavos: l.lineTotalCentavos,
      options: l.options.map((x) => ({ name: x.name, priceCentavos: x.priceCentavos })),
    })),
  }
}

/** The receipt order and the shop's settings from one read; null when there is no such order. */
export async function loadReceipt(code: string): Promise<{ order: ReceiptOrder; settings: ShopSettings } | null> {
  const view = await fetchReceipt(code)
  if (!view) return null
  return { order: toReceiptOrder(view.order), settings: view.shop ?? FALLBACK_SETTINGS }
}
