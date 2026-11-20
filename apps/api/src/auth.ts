import { createHash, timingSafeEqual } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import type { MiddlewareHandler } from 'hono'
import type { AppDeps } from './create-app.js'
import { sha256Hex } from './devices/tokens.js'
import { apiError } from './http.js'

export type StaffRole = 'owner' | 'manager' | 'barista'

/** Hono context typing: `staff` behind `requireStaff`, `device` behind `requireDevice`, `userId` behind `optionalUser` (or `requireUser`, never null there). */
export type AppEnv = {
  Variables: {
    staff: { id: string; role: StaffRole }
    device: { id: string; name: string }
    userId: string | null
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type VerifyUser = (token: string) => Promise<{ userId: string }>

/** Verifier over any JWKS source, so tests can inject a local key set. */
export function verifierFromJwks(jwks: JWTVerifyGetKey, issuer: string): VerifyUser {
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: 'authenticated',
        algorithms: ['ES256'],
      })
      if (!payload.sub || !UUID.test(payload.sub)) throw new Error('token subject is not a uuid')
      return { userId: payload.sub }
    } catch {
      throw apiError(401, 'UNAUTHENTICATED', 'Invalid or expired token')
    }
  }
}

export function createUserVerifier(supabaseUrl: string): VerifyUser {
  const base = supabaseUrl.replace(/\/+$/, '')
  const jwks = createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', base))
  return verifierFromJwks(jwks, `${base}/auth/v1`)
}

const bearer = (header: string | undefined) => /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1] ?? null

/**
 * Links a signed-in customer when the token verifies. A missing, invalid or expired token is a
 * guest, never a refusal (Ruling 4).
 */
export function optionalUser(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = bearer(c.req.header('Authorization'))
    let userId: string | null = null
    if (token) {
      try {
        userId = (await deps.verifyUser(token)).userId
      } catch {
        userId = null
      }
    }
    c.set('userId', userId)
    await next()
  }
}

/** Customer routes: 401 on a missing or invalid token, otherwise sets `userId`. */
export function requireUser(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = bearer(c.req.header('Authorization'))
    if (!token) throw apiError(401, 'UNAUTHENTICATED', 'Missing bearer token')
    c.set('userId', (await deps.verifyUser(token)).userId)
    await next()
  }
}

/** `'owner'` admits owners only; `'manager'` admits owners and managers; no role admits any active staff. */
export function requireStaff(deps: AppDeps, role?: 'owner' | 'manager'): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = bearer(c.req.header('Authorization'))
    if (!token) throw apiError(401, 'UNAUTHENTICATED', 'Missing bearer token')

    const { userId } = await deps.verifyUser(token)

    // Re-checked on every request so deactivation takes effect immediately.
    const [row] = await deps.sql<{ id: string; role: StaffRole; is_active: boolean }[]>`
      select id, role, is_active from staff where user_id = ${userId}
    `
    if (!row || !row.is_active) throw apiError(403, 'FORBIDDEN', 'Not an active staff member')
    const allowed = role === 'owner' ? row.role === 'owner' : role === 'manager' ? row.role !== 'barista' : true
    if (!allowed) throw apiError(403, 'FORBIDDEN', 'Insufficient role')

    c.set('staff', { id: row.id, role: row.role })
    await next()
  }
}

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest()

/**
 * The website's server-to-server key (`X-Kennko-Web-Key`, Ruling 13), for the staff alert list only:
 * checkout has no signed-in user to send. Compared in constant time over SHA-256 digests, so neither
 * the content nor the length of the key leaks. No key configured → 503 whatever the header says.
 */
export function requireWebKey(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (deps.webKey === null) throw apiError(503, 'NOT_CONFIGURED', 'The website key is not configured')
    const given = c.req.header('X-Kennko-Web-Key')
    if (!given || !timingSafeEqual(digest(given), digest(deps.webKey))) {
      throw apiError(401, 'UNAUTHENTICATED', 'Missing or wrong website key')
    }
    await next()
  }
}

/** Till routes: `Authorization: Bearer kd_…`, matched by SHA-256 against `devices.token_hash`. */
export function requireDevice(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = bearer(c.req.header('Authorization'))
    if (!token || !token.startsWith('kd_')) throw apiError(401, 'UNAUTHENTICATED', 'Missing device token')

    const [row] = await deps.sql<{ id: string; name: string }[]>`
      select id, name from devices where token_hash = ${sha256Hex(token)} and revoked_at is null
    `
    if (!row) throw apiError(401, 'DEVICE_REVOKED', 'This till was disconnected. Pair it again.')

    const now = deps.now()
    await deps.sql`
      update devices set last_seen_at = ${now}
      where id = ${row.id} and (last_seen_at is null or last_seen_at < ${now}::timestamptz - interval '1 minute')
    `
    c.set('device', { id: row.id, name: row.name })
    await next()
  }
}
