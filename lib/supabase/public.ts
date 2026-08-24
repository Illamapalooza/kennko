import { createClient } from '@supabase/supabase-js'
import { getEnv } from '@/lib/env'

/**
 * Cookie-free anon client for public, unauthenticated reads.
 *
 * The cookie-aware client in `server.ts` opts a route into dynamic rendering,
 * which would make the marketing page re-query Supabase on every request and
 * silently disable its ISR `revalidate`. Public menu reads carry no session,
 * so they use this instead and the page stays statically cached.
 */
export function getPublicClient() {
  const env = getEnv()
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
