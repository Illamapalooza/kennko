import { createHash, randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

/** Who opened the till on a device. Shared PINs from config.json carry no person. */
export type Who = { staffId: string | null; name: string | null; role: 'staff' | 'manager' }

/** A till session lasts one long working day from when the PIN was typed. */
export const SESSION_MS = 16 * 60 * 60 * 1000

const COOKIE = 'kennko_pos_session'
const hash = (token: string) => createHash('sha256').update(token).digest('hex')

/**
 * The PIN is typed once per browser and exchanged for a random token in a cookie. Only the token's SHA-256 is kept,
 * in the till's own database (table `sessions`, made by store.ts), so sessions survive a restart of the till.
 */
export function createSessions(db: DatabaseSync, now: () => number) {
  const toWho = (row: any): Who => ({ staffId: row.staff_id ?? null, name: row.staff_name ?? null, role: row.role === 'manager' ? 'manager' : 'staff' })
  return {
    start(who: Who): string {
      const token = randomBytes(32).toString('base64url')
      const at = now()
      db.prepare('delete from sessions where created_at <= ?').run(at - SESSION_MS)
      db.prepare('insert into sessions (token_hash, staff_id, staff_name, role, created_at) values (?, ?, ?, ?, ?)')
        .run(hash(token), who.staffId, who.name, who.role, at)
      return token
    },

    get(token: string | undefined): Who | null {
      if (!token) return null
      const key = hash(token)
      const row = db.prepare('select * from sessions where token_hash = ?').get(key) as any
      if (!row) return null
      if (now() >= row.created_at + SESSION_MS) {
        db.prepare('delete from sessions where token_hash = ?').run(key)
        return null
      }
      return toWho(row)
    },

    end(token: string | undefined): void {
      if (token) db.prepare('delete from sessions where token_hash = ?').run(hash(token))
    },

    /** Ends every session whose person no longer passes `keep`. */
    keepOnly(keep: (who: Who) => boolean): void {
      const rows = db.prepare('select * from sessions').all() as any[]
      const drop = db.prepare('delete from sessions where token_hash = ?')
      for (const row of rows) if (!keep(toWho(row))) drop.run(row.token_hash)
    },
  }
}

export type Sessions = ReturnType<typeof createSessions>

/** No Max-Age: the cookie lasts until the browser closes, and the till ends it sooner after SESSION_MS. */
export function sessionCookie(token: string | null, secure: boolean): string {
  const parts = [`${COOKIE}=${token ?? ''}`, 'HttpOnly', 'SameSite=Strict', 'Path=/']
  if (token === null) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function readSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === COOKIE) return part.slice(eq + 1).trim() || undefined
  }
  return undefined
}
