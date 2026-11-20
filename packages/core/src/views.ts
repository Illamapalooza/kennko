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

/** `GET /v1/orders/by-code/:code/receipt`. `payment` is the live one; `shop` is null when its row is missing. */
export type ReceiptView = {
  order: {
    orderCode: string
    ticket: string
    customerName: string
    fulfilment: 'pickup' | 'delivery'
    deliveryAddress: string | null
    deliveryBarangay: string | null
    prepStatus: PrepStatus
    paymentStatus: PaymentStatus
    cancelledAt: string | null
    subtotalCentavos: number
    discountCentavos: number
    deliveryFeeCentavos: number
    totalCentavos: number
    payment: { reference: string | null; verifiedAt: string | null } | null
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
