// Vercel entry: zero-config Hono deploys this file's default export. Vercel only treats a file as
// the entry if it imports hono, hence the explicit type below.
import type { Hono } from 'hono'
import { createApp } from './create-app.js'
import { createUserVerifier, type AppEnv } from './auth.js'
import { loadConfig } from './config.js'
import { createSql } from './db.js'
import { createProofStore } from './storage.js'

const config = loadConfig(process.env)

const app: Hono<AppEnv> = createApp({
  sql: createSql(config.databaseUrl),
  verifyUser: createUserVerifier(config.supabaseUrl),
  proofs: createProofStore(config.supabaseUrl, config.supabaseServiceRoleKey),
  now: () => new Date(),
})

export default app
