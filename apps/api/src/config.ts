import { z } from 'zod'

export type Config = {
  databaseUrl: string
  supabaseUrl: string
  supabaseServiceRoleKey: string
  /** All three VAPID variables or none; none means push is off and the API still boots. */
  vapid: { publicKey: string; privateKey: string; subject: string } | null
}

const schema = z.object({
  DATABASE_URL: z.url(),
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().min(1).optional(),
})

export function loadConfig(env: Record<string, string | undefined>): Config {
  // Blank means unset, so an empty Vercel variable turns push off instead of crashing the API.
  const clean = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''))
  const parsed = schema.safeParse(clean)
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))]
    throw new Error(`Missing or invalid environment variable: ${names.join(', ')}`)
  }
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = parsed.data
  const given = [publicKey, privateKey, subject].filter(Boolean).length
  if (given !== 0 && given !== 3) {
    throw new Error('Missing or invalid environment variable: set all of VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, or none')
  }
  return {
    vapid: publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null,
    databaseUrl: parsed.data.DATABASE_URL,
    supabaseUrl: parsed.data.SUPABASE_URL,
    supabaseServiceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
  }
}
