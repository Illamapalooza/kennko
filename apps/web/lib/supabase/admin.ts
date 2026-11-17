import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * Service-role client. Bypasses RLS entirely, so every caller MUST establish
 * the caller's role first via requireOwner()/requireStaff(). The `server-only`
 * import makes bundling this into a client component a build error rather than
 * a silent key leak.
 */
export function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
