import type { Hono } from 'hono'
import { createApp } from './create-app.js'
import { createUserVerifier, type AppEnv } from './auth.js'
import { loadConfig } from './config.js'
import { createSql } from './db.js'
import { vercelDefer } from './push/defer.js'
import { createPushSenderSafely } from './push/send.js'
import { createProofStore } from './storage.js'

/** The production app from environment variables. Nothing here connects until a request needs it. */
export function buildApp(env: Record<string, string | undefined>): Hono<AppEnv> {
  const config = loadConfig(env)
  const push = createPushSenderSafely(config.vapid)
  return createApp({
    sql: createSql(config.databaseUrl),
    verifyUser: createUserVerifier(config.supabaseUrl),
    proofs: createProofStore(config.supabaseUrl, config.supabaseServiceRoleKey),
    now: () => new Date(),
    defer: vercelDefer,
    push,
    vapidPublicKey: push && config.vapid ? config.vapid.publicKey : null,
  })
}
