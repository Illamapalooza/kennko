import type { IceLevel, IceServe } from './ice.ts'
import type { PaymentStatus, PrepStatus } from './order-status.ts'

/**
 * What the API's customer-facing reads return. Raw fields (statuses, ice): the website maps them
 * with `orderStage`, `iceSummary` and `buildReceipt`. Each is today's projection exactly, never more
 * (Rulings 10 and 11): no proof path, staff note, phone, email or verifier.
 */

/** `GET /v1/orders/by-code/:code`: the order page. */
export type PublicOrderView = {
  orderCode: string
  ticket: string
  prepStatus: PrepStatus
  paymentStatus: PaymentStatus
  cancelled: boolean
  fulfilment: 'pickup' | 'delivery'
  fulfilAt: string
  totalCentavos: number
  deliveryAddress: string | null
  lines: { name: string; variantLabel: string; quantity: number; iceLevel: IceLevel | null; iceServe: IceServe | null }[]
}

export type ShopView = {
  displayName: string
  registeredName: string | null
  tin: string | null
  address: string
  phone: string | null
  facebookUrl: string | null
  receiptFooter: string
}

/**
 * `GET /v1/orders/by-code/:code/receipt`: the PUBLIC receipt (Ruling P6-4). The order code is the only
 * key, so it shows no more than the order page: the first name only, the delivery barangay (never the
 * street), and the GCash reference masked to its last 4, only once the payment is confirmed (`paid` or
 * `refunded`; otherwise `payment` is null). The full name, address and reference are for the emailed
 * receipt only, which a staff route provides. `shop` is null when its row is missing.
 */
export type PublicReceiptView = {
  order: {
    orderCode: string
    ticket: string
    customerFirstName: string
    fulfilment: 'pickup' | 'delivery'
    deliveryBarangay: string | null
    prepStatus: PrepStatus
    paymentStatus: PaymentStatus
    cancelledAt: string | null
    subtotalCentavos: number
    discountCentavos: number
    deliveryFeeCentavos: number
    totalCentavos: number
    /** `'••••' + last 4`, or `'••••'` when the reference is shorter than 5 characters. */
    payment: { referenceMasked: string | null; verifiedAt: string | null } | null
    lines: {
      itemName: string
      variantLabel: string
      quantity: number
      unitPriceCentavos: number
      lineTotalCentavos: number
      options: { name: string; priceCentavos: number }[]
    }[]
  }
  shop: ShopView | null
}

/** `GET /v1/me/orders`: one of a signed-in customer's orders. */
export type HistoryOrderView = {
  id: string
  orderCode: string
  ticket: string
  prepStatus: PrepStatus
  paymentStatus: PaymentStatus
  cancelled: boolean
  fulfilment: 'pickup' | 'delivery'
  fulfilAt: string
  createdAt: string
  deliveryAddress: string | null
  subtotalCentavos: number
  deliveryFeeCentavos: number
  totalCentavos: number
  /** A guest order matched by the confirmed address rather than placed while signed in. */
  claimedByEmail: boolean
  lines: {
    name: string
    variantCode: string
    variantLabel: string
    quantity: number
    iceLevel: IceLevel | null
    iceServe: IceServe | null
    note: string | null
    options: string[]
  }[]
}
