import { z } from 'zod'

export type Config = { databaseUrl: string; supabaseUrl: string }

const schema = z.object({
  DATABASE_URL: z.url(),
  SUPABASE_URL: z.url(),
})

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))]
    throw new Error(`Missing or invalid environment variable: ${names.join(', ')}`)
  }
  return { databaseUrl: parsed.data.DATABASE_URL, supabaseUrl: parsed.data.SUPABASE_URL }
}
