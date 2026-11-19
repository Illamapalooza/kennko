import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import type { MiddlewareHandler } from 'hono'
import type { AppDeps } from './create-app.js'
import { apiError } from './http.js'

export type StaffRole = 'owner' | 'barista'

/** Hono context typing: `staff` behind `requireStaff`, `userId` behind `optionalUser`. */
export type AppEnv = {
  Variables: { staff: { id: string; role: StaffRole }; userId: string | null }
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

export function requireStaff(deps: AppDeps, role?: 'owner'): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = bearer(c.req.header('Authorization'))
    if (!token) throw apiError(401, 'UNAUTHENTICATED', 'Missing bearer token')

    const { userId } = await deps.verifyUser(token)

    // Re-checked on every request so deactivation takes effect immediately.
    const [row] = await deps.sql<{ role: StaffRole; is_active: boolean }[]>`
      select role, is_active from staff where id = ${userId}
    `
    if (!row || !row.is_active) throw apiError(403, 'FORBIDDEN', 'Not an active staff member')
    if (role && row.role !== role) throw apiError(403, 'FORBIDDEN', 'Insufficient role')

    c.set('staff', { id: userId, role: row.role })
    await next()
  }
}
