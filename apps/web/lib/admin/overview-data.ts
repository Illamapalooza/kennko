import 'server-only'
import { orderStage, ticketLabel, type OrderStage, type PaymentStatus, type PrepStatus } from '@kennko/core'
import { getServerClient } from '@/lib/supabase/server'

/** Null when the count could not be read, so the UI can show "—" rather than a misleading 0. */
export async function countOrdersToCheck(): Promise<number | null> {
  const db = await getServerClient()
  const { count, error } = await db
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('channel', 'online')
    .eq('payment_status', 'pending_verification')
    .neq('prep_status', 'cancelled')
  if (error) {
    console.error('countOrdersToCheck failed', error.message)
    return null
  }
  return count ?? 0
}

/** Null when any of the counts could not be read. */
export async function countSoldOut(): Promise<number | null> {
  const db = await getServerClient()
  const tables = ['menu_items', 'menu_variants', 'options'] as const
  const counts = await Promise.all(
    tables.map(async (table) => {
      const { count, error } = await db
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('is_available', false)
        .eq('is_archived', false)
      if (error) {
        console.error(`countSoldOut failed for ${table}`, error.message)
        return null
      }
      return count ?? 0
    }),
  )
  if (counts.some((c) => c === null)) return null
  return counts.reduce<number>((a, b) => a + (b ?? 0), 0)
}

export type RecentOrder = {
  id: string
  orderCode: string
  ticket: string
  customerName: string
  stage: OrderStage
  totalCentavos: number
}

export async function recentOrders(limit = 5): Promise<RecentOrder[]> {
  const db = await getServerClient()
  const { data, error } = await db
    .from('orders')
    .select(
      'id, order_code, customer_name, prep_status, payment_status, ticket_series, ticket_number, total_centavos, cancelled_at',
    )
    .eq('channel', 'online')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('recentOrders failed', error.message)
    return []
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    orderCode: r.order_code as string,
    ticket: ticketLabel(r.ticket_series as 'C' | 'W', r.ticket_number as number),
    customerName: r.customer_name as string,
    stage: orderStage(r.prep_status as PrepStatus, r.payment_status as PaymentStatus, r.cancelled_at != null),
    totalCentavos: r.total_centavos as number,
  }))
}
