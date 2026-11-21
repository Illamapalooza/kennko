import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CHECKIN_URL, checkinLink, wallCode, wallMinute } from '@kennko/core'
import { currentCheckin, msToNextMinute, storedSkew } from '../server/checkin.ts'
import { createStore } from '../server/store.ts'

const SECRET = 'k'.repeat(43) // 32 random bytes as base64url are 43 characters
const T = Date.UTC(2026, 10, 21, 2, 0, 30) // half a minute in

function withSecret(skew: number | null = 0) {
  const store = createStore(':memory:')
  store.setCheckin({ secret: SECRET, url: CHECKIN_URL })
  if (skew !== null) store.kvSet('checkin_skew', String(skew))
  return store
}

describe('currentCheckin', () => {
  it('is null without a secret', async () => {
    const store = createStore(':memory:')
    store.kvSet('checkin_skew', '0')
    expect(await currentCheckin(store, T)).toBeNull()
  })

  it('is null with a secret but no measured skew yet (Ruling 6)', async () => {
    expect(await currentCheckin(withSecret(null), T)).toBeNull()
  })

  it("uses the server's minute (the till's clock plus the skew), not the till's own", async () => {
    const store = withSecret(90_000)
    const c = (await currentCheckin(store, T))!
    const serverMinute = wallMinute(T + 90_000)
    expect(serverMinute).not.toBe(wallMinute(T))
    expect(c.minute).toBe(serverMinute)
    const code = await wallCode(SECRET, serverMinute)
    expect(c.url).toBe(checkinLink(CHECKIN_URL, code))
    expect(c.url).not.toContain(await wallCode(SECRET, wallMinute(T)))
  })

  it('links to the pulled URL with ?c= and 8 base32 characters, never the secret', async () => {
    const c = (await currentCheckin(withSecret(), T))!
    expect(c.url).toMatch(/^https:\/\/kennko\.vercel\.app\/here\?c=[a-z2-7]{8}$/)
    expect(JSON.stringify(c)).not.toContain(SECRET)
  })

  it('gives square modules of 0 and 1, at least 25 wide', async () => {
    const { modules } = (await currentCheckin(withSecret(), T))!
    expect(modules.length).toBeGreaterThanOrEqual(25)
    for (const row of modules) {
      expect(row).toHaveLength(modules.length)
      expect(row).toMatch(/^[01]+$/)
    }
  })

  it('changes the next minute, and is the same object within a minute (memoised)', async () => {
    const store = withSecret()
    const a = (await currentCheckin(store, T))!
    expect(await currentCheckin(store, T + 20_000)).toBe(a)
    const b = (await currentCheckin(store, T + 60_000))!
    expect(b.minute).toBe(a.minute + 1)
    expect(b.url).not.toBe(a.url)
    expect(b.modules).not.toEqual(a.modules)
  })

  it('follows a new secret or a cleared one at once', async () => {
    const store = withSecret()
    const a = (await currentCheckin(store, T))!
    store.setCheckin({ secret: 'z'.repeat(43), url: CHECKIN_URL })
    expect((await currentCheckin(store, T))!.url).not.toBe(a.url)
    store.clearCheckin()
    expect(await currentCheckin(store, T)).toBeNull()
  })

  it('logs nothing', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    await currentCheckin(withSecret(), T)
    for (const s of spies) { expect(s).not.toHaveBeenCalled(); s.mockRestore() }
  })
})

describe('storedSkew', () => {
  it('reads the persisted skew, and null for none or a broken value', () => {
    const store = createStore(':memory:')
    expect(storedSkew(store)).toBeNull()
    store.kvSet('checkin_skew', '-1500')
    expect(storedSkew(store)).toBe(-1500)
    store.kvSet('checkin_skew', 'nope')
    expect(storedSkew(store)).toBeNull()
  })
})

describe('msToNextMinute', () => {
  it('counts to the next server minute', () => {
    const M = Date.UTC(2026, 10, 21, 2, 0)
    expect(msToNextMinute(M + 10_000, 0)).toBe(50_000)
    expect(msToNextMinute(M, 0)).toBe(60_000)
    expect(msToNextMinute(M + 10_000, 5_000)).toBe(45_000)
  })

  it('is correct with a negative skew (the server behind the till)', () => {
    const M = Date.UTC(2026, 10, 21, 2, 0)
    // server = M + 10 s − 25 s = M − 15 s, so the server's next minute is 15 s away
    expect(msToNextMinute(M + 10_000, -25_000)).toBe(15_000)
    expect(msToNextMinute(M + 10_000, -70_000)).toBe(60_000) // M − 60 s exactly: a whole minute to go
    expect(msToNextMinute(M + 10_000, -75_000)).toBe(5_000) // M − 65 s: 5 s before M − 60 s
  })
})

describe('the secret stays in the server process', () => {
  const server = path.join(import.meta.dirname, '..', 'server')
  const src = path.join(import.meta.dirname, '..', 'src')

  it('only the store and checkin.ts read it; index.ts never touches the config', () => {
    const readers = fs.readdirSync(server).filter((f) => /checkin_secret|checkinConfig\(/.test(fs.readFileSync(path.join(server, f), 'utf8')))
    expect(readers.sort()).toEqual(['checkin.ts', 'store.ts'])
  })

  it('the tablet screens (src) never mention it', () => {
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
      .flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]))
    for (const f of walk(src)) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/checkin_secret|checkinConfig|secret/i)
  })
})
