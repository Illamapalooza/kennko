import { createBrowserClient } from '@supabase/ssr'
import { getEnv } from '@/lib/env'

export function getBrowserClient() {
  const env = getEnv()
  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey)
}
