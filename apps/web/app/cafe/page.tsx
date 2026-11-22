import { apiBase } from '@/lib/api/client'
import { getServerClient } from '@/lib/supabase/server'
import { OrderNav } from '@/components/order/OrderNav'
import { LiveCafeWall } from '@/components/cafe/LiveCafeWall'
import './cafe.css'

export const dynamic = 'force-dynamic'

async function loadInitialWall() {
  const base = apiBase()
  if (!base) return { now: Date.now(), baristas: 0, orders: [], visitors: [], offline: true }
  try {
    const res = await fetch(`${base}/v1/wall`, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch {
    return { now: Date.now(), baristas: 0, orders: [], visitors: [], offline: true }
  }
}

export default async function CafePage() {
  const [initial, supabase] = await Promise.all([loadInitialWall(), getServerClient()])
  const { data } = await supabase.auth.getUser()

  return (
    <div className="cafe-page">
      <OrderNav place="cafe" signedIn={Boolean(data.user)} />
      <LiveCafeWall initial={initial} />
    </div>
  )
}
