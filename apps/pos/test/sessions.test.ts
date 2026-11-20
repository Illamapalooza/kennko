import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createStore } from '../server/store.ts'
import { SESSION_MS, createSessions, readSessionCookie, sessionCookie, type Who } from '../server/sessions.ts'

const T = Date.UTC(2026, 10, 20, 1, 0)
const shared: Who = { staffId: null, name: null, role: 'staff' }
const ana: Who = { staffId: 'a1', name: 'Ana Cruz', role: 'manager' }

function clock(start = T) {
  let at = start
  return { now: () => at, set: (next: number) => { at = next } }
}

describe('till sessions', () => {
  it('hands out a 43-character token and keeps only its SHA-256', () => {
    const store = createStore(':memory:')
    const sessions = createSessions(store.db, clock().now)
    const token = sessions.start(ana)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const rows = store.db.prepare('select * from sessions').all() as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'))
    expect(JSON.stringify(rows)).not.toContain(token)
    expect(rows[0]).toMatchObject({ staff_id: 'a1', staff_name: 'Ana Cruz', role: 'manager', created_at: T })
  })

  it('finds who a token belongs to until 16 hours after it started', () => {
    const store = createStore(':memory:')
    const c = clock()
    const sessions = createSessions(store.db, c.now)
    const token = sessions.start(ana)
    expect(sessions.get(token)).toEqual(ana)
    c.set(T + SESSION_MS - 1)
    expect(sessions.get(token)).toEqual(ana)
    c.set(T + SESSION_MS)
    expect(sessions.get(token)).toBeNull()
    expect(store.db.prepare('select count(*) as n from sessions').get()).toEqual({ n: 0 })
  })

  it('knows nothing of a missing or unknown token', () => {
    const store = createStore(':memory:')
    const sessions = createSessions(store.db, clock().now)
    sessions.start(shared)
    expect(sessions.get(undefined)).toBeNull()
    expect(sessions.get('')).toBeNull()
    expect(sessions.get('not-a-token')).toBeNull()
  })

  it('ends a session', () => {
    const store = createStore(':memory:')
    const sessions = createSessions(store.db, clock().now)
    const token = sessions.start(shared)
    const other = sessions.start(ana)
    sessions.end(token)
    sessions.end(undefined)
    expect(sessions.get(token)).toBeNull()
    expect(sessions.get(other)).toEqual(ana)
  })

  it('survives the till closing and opening the same database again', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kennko-pos-sessions-'))
    try {
      const file = path.join(dir, 'pos.db')
      const first = createStore(file)
      const token = createSessions(first.db, clock().now).start(ana)
      first.close()
      const again = createStore(file)
      expect(createSessions(again.db, clock(T + 60_000).now).get(token)).toEqual(ana)
      again.close()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps only the sessions it is told to', () => {
    const store = createStore(':memory:')
    const sessions = createSessions(store.db, clock().now)
    const a = sessions.start(shared)
    const b = sessions.start({ ...shared, role: 'manager' })
    const c = sessions.start(ana)
    sessions.keepOnly((w) => w.staffId !== null)
    expect(sessions.get(a)).toBeNull()
    expect(sessions.get(b)).toBeNull()
    expect(sessions.get(c)).toEqual(ana)
  })
})

describe('session cookie', () => {
  it('reads the till cookie out of a Cookie header', () => {
    expect(readSessionCookie('a=1; kennko_pos_session=abc')).toBe('abc')
    expect(readSessionCookie('kennko_pos_session=xyz')).toBe('xyz')
    expect(readSessionCookie('a=1')).toBeUndefined()
    expect(readSessionCookie(undefined)).toBeUndefined()
  })

  it('reads the cookie named for the scheme the request came in on', () => {
    expect(readSessionCookie('__Secure-kennko_pos_session=sec', true)).toBe('sec')
    expect(readSessionCookie('__Secure-kennko_pos_session=sec', false)).toBeUndefined()
    expect(readSessionCookie('kennko_pos_session=plain', true)).toBeUndefined()
    const both = 'kennko_pos_session=plain; __Secure-kennko_pos_session=sec'
    expect(readSessionCookie(both, true)).toBe('sec')
    expect(readSessionCookie(both, false)).toBe('plain')
    expect(readSessionCookie('__Secure-kennko_pos_session=sec; kennko_pos_session=plain')).toBe('plain')
  })

  it('uses the __Secure- name on https and the plain name on http', () => {
    expect(sessionCookie('abc', true).startsWith('__Secure-kennko_pos_session=abc;')).toBe(true)
    expect(sessionCookie('abc', false).startsWith('kennko_pos_session=abc;')).toBe(true)
  })

  it('is HttpOnly, Strict and lasts as long as the browser session', () => {
    const cookie = sessionCookie('abc', true)
    for (const part of ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Secure']) expect(cookie).toContain(part)
    expect(cookie).not.toContain('Max-Age')
    expect(sessionCookie('abc', false)).not.toContain('Secure')
  })

  it('expires the cookie when there is no token', () => {
    const cookie = sessionCookie(null, false)
    expect(cookie.startsWith('kennko_pos_session=;')).toBe(true)
    expect(cookie).toContain('Max-Age=0')
    expect(cookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
    const secure = sessionCookie(null, true)
    expect(secure.startsWith('__Secure-kennko_pos_session=;')).toBe(true)
    expect(secure).toContain('Secure')
    expect(secure).toContain('Max-Age=0')
  })
})
