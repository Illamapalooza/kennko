export type AppEnv = {
  supabaseUrl: string
  supabaseAnonKey: string
  /** Optional: without it the menu is empty (see lib/menu/api.ts). */
  apiUrl: string | undefined
}

export function readEnv(source: Record<string, string | undefined>): AppEnv {
  const url = source.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = source.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL')
  if (!anonKey) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (!url.startsWith('https://')) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must be https')
  }

  const apiUrl = source.KENNKO_API_URL || undefined
  if (apiUrl && !URL.canParse(apiUrl)) {
    throw new Error('KENNKO_API_URL must be a valid URL')
  }

  return { supabaseUrl: url, supabaseAnonKey: anonKey, apiUrl }
}

let cached: AppEnv | undefined

/**
 * Resolved lazily rather than at module load, so importing this module never
 * throws. A module-level `readEnv(process.env)` would crash any test that
 * imports it, and would fail `next build` wherever the vars are not set.
 *
 * The two vars are read as LITERAL static property paths. Next only inlines
 * `NEXT_PUBLIC_*` into a client bundle when it can see the full path at build
 * time; passing `process.env` around as an object defeats that, leaving it as
 * `{}` in the browser. That failure appears only at runtime in a client
 * component -- typecheck and build both pass.
 */
export function getEnv(): AppEnv {
  cached ??= readEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    KENNKO_API_URL: process.env.KENNKO_API_URL,
  })
  return cached
}
