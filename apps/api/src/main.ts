// Source entry, bundled by `npm run build` into server.js (the file Vercel deploys) together with
// @kennko/core, which Node cannot run from node_modules as TypeScript.
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
