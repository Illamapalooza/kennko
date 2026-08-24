import { createClient } from '@supabase/supabase-js'
import { SEED_ZONES } from '../supabase/seed/zones'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } })

async function main() {
  const rows = SEED_ZONES.map((zone, index) => ({
    barangay: zone.barangay,
    fee_centavos: zone.feeCentavos,
    sort_order: index,
    is_active: true,
  }))

  const { error } = await db
    .from('delivery_zones')
    .upsert(rows, { onConflict: 'barangay' })
  if (error) throw error

  console.log(`Seeded ${rows.length} delivery zones.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
