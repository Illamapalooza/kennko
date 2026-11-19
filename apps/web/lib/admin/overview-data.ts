import 'server-only'
import { getServerClient } from '@/lib/supabase/server'

export async function countOrdersToCheck(): Promise<number> {
  const db = await getServerClient()
  const { count, error } = await db
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'awaiting_verification')
  if (error) {
    console.error('countOrdersToCheck failed', error.message)
    return 0
  }
  return count ?? 0
}

export async function countSoldOut(): Promise<number> {
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
        return 0
      }
      return count ?? 0
    }),
  )
  return counts.reduce((a, b) => a + b, 0)
}

export type RecentOrder = {
  id: string
  orderCode: string
  customerName: string
  status: string
  totalCentavos: number
}

export async function recentOrders(limit = 5): Promise<RecentOrder[]> {
  const db = await getServerClient()
  const { data, error } = await db
    .from('orders')
    .select('id, order_code, customer_name, status, total_centavos')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('recentOrders failed', error.message)
    return []
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    orderCode: r.order_code as string,
    customerName: r.customer_name as string,
    status: r.status as string,
    totalCentavos: r.total_centavos as number,
  }))
}
