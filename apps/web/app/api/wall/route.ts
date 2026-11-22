import { NextResponse } from 'next/server'
import { apiBase } from '@/lib/api/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  const base = apiBase()
  if (!base) {
    return NextResponse.json({ now: Date.now(), baristas: 0, orders: [], visitors: [], offline: true }, { status: 200 })
  }
  try {
    const res = await fetch(`${base}/v1/wall`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ now: Date.now(), baristas: 0, orders: [], visitors: [], offline: true }, { status: 200 })
  }
}
