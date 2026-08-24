export type AppEnv = {
  supabaseUrl: string
  supabaseAnonKey: string
}

export function readEnv(source: Record<string, string | undefined>): AppEnv {
  const url = source.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = source.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL')
  if (!anonKey) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (!url.startsWith('https://')) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must be https')
  }

  return { supabaseUrl: url, supabaseAnonKey: anonKey }
}

let cached: AppEnv | undefined

/**
 * Resolved lazily rather than at module load, so importing this module never
 * throws. A module-level `readEnv(process.env)` would crash any test that
 * imports it, and would fail `next build` wherever the vars are not set.
 */
export function getEnv(): AppEnv {
  cached ??= readEnv(process.env as Record<string, string | undefined>)
  return cached
}
