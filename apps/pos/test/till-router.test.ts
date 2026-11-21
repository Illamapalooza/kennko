import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { nodeFiles } from '../server/node-files.ts'
import { openNodeSqlite } from '../server/node-sqlite.ts'
import { saveDevice } from '../till/device.ts'
import type { TillConfig } from '../till/host.ts'
import { builtInMenu } from '../till/menu.ts'
import { createTill } from '../till/till.ts'

const T = Date.UTC(2026, 10, 22, 2, 0)
const API = 'https://api.kennko.test'
const TOKEN = 'kd_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'

const tempDirs: string[] = []
afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function makeTill(opts: {
  firstRun?: 'pins' | 'connect'
  staffPin?: string
  managerPin?: string
  fetchFn?: typeof fetch
  now?: () => number
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kennko-till-router-'))
  tempDirs.push(dir)
  const dbPath = path.join(dir, 'pos.db')
  const sql = openNodeSqlite(dbPath)
  const files = nodeFiles(dir)
  let clock = T
  const now = opts.now ?? (() => clock)
  const config: TillConfig = {
    staffPin: opts.staffPin ?? '1234',
    managerPin: opts.managerPin ?? '0000',
    shop: { name: 'Kennko Coffee', address: 'Butuan', phone: '', receiptFooter: 'Thanks' },
    discounts: [],
    apiUrl: API,
    firstRun: opts.firstRun ?? 'pins',
  }
  const fetchFn: typeof fetch = opts.fetchFn ?? (async () => new Response(JSON.stringify({}), { status: 503 }))
  const timers = {
    set: ((fn: (...a: any[]) => void, ms?: number) => setTimeout(fn, ms)) as typeof setTimeout,
    clear: ((id: any) => clearTimeout(id)) as typeof clearTimeout,
  }
  const till = createTill({
    sql,
    open: openNodeSqlite,
    files,
    fetch: fetchFn,
    config,
    baseMenu: builtInMenu(T),
    host: 'node',
    backup: () => 'ok',
    now,
    timers,
  })
  return { till, files, sql, setClock: (t: number) => { clock = t } }
}

describe('createTill router', () => {
  it('bootstrap reports host and firstRun', async () => {
    const { till, sql } = makeTill({ firstRun: 'connect', staffPin: '', managerPin: '' })
    const res = await till.request({ method: 'GET', path: '/api/bootstrap', client: '1.1.1.1' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ host: 'node', firstRun: 'connect', pinMode: 'per-person', noLeads: false })
    sql.close()
  })

  it('connect mode refuses selling before pairing', async () => {
    const { till, sql } = makeTill({ firstRun: 'connect', staffPin: '', managerPin: '' })
    const orderRes = await till.request({ method: 'POST', path: '/api/orders', body: {}, client: '1.1.1.1' })
    expect(orderRes.status).toBe(409)
    expect(orderRes.body).toEqual({ error: 'Connect this till first.' })

    const menuRes = await till.request({ method: 'GET', path: '/api/menu', client: '1.1.1.1' })
    expect(menuRes.status).toBe(409)
    expect(menuRes.body).toEqual({ error: 'Connect this till first.' })
    sql.close()
  })

  it('connect mode pairs without a PIN the first time', async () => {
    const fetchFn: typeof fetch = async (url) => {
      if (String(url).endsWith('/v1/devices/pair')) {
        return new Response(JSON.stringify({ deviceId: 'd-1', name: 'Counter tablet', token: TOKEN }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({}), { status: 503 })
    }
    const { till, sql } = makeTill({ firstRun: 'connect', staffPin: '', managerPin: '', fetchFn })
    const res = await till.request({ method: 'POST', path: '/api/device/pair', body: { code: '123456' }, client: '1.1.1.1' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ name: 'Counter tablet' })
    sql.close()
  })

  it('connect mode wants a manager PIN to pair again after revoke', async () => {
    const { hashStaffPin } = await import('@kennko/core/staff-pin')
    const { till, files, sql } = makeTill({ firstRun: 'connect', staffPin: '', managerPin: '' })
    saveDevice(files, { deviceId: 'd-1', name: 'Counter', token: TOKEN, pairedAt: T, revokedAt: T + 1000 })
    till.store.replaceStaffCache([{ id: 'm-1', fullName: 'Owner', role: 'owner', pinHash: await hashStaffPin('111111') }])
    const login = await till.request({ method: 'POST', path: '/api/session', body: { pin: '111111' }, client: '1.1.1.1' })
    const res = await till.request({ method: 'POST', path: '/api/device/pair', body: { code: '123456' }, session: login.session!, client: '1.1.1.1' })
    expect(res.status).toBe(403)
    sql.close()
  })

  it('connect mode with no lead PIN', async () => {
    const { till, files, sql } = makeTill({ firstRun: 'connect', staffPin: '', managerPin: '' })
    saveDevice(files, { deviceId: 'd-1', name: 'Counter', token: TOKEN, pairedAt: T, revokedAt: null })
    const boot = await till.request({ method: 'GET', path: '/api/bootstrap', client: '1.1.1.1' })
    expect(boot.body).toMatchObject({ pinMode: 'per-person', noLeads: true })

    const res = await till.request({ method: 'POST', path: '/api/session', body: { pin: '000000' }, client: '1.1.1.1' })
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Wrong PIN.' })
    sql.close()
  })

  it('pins mode behaves as before', async () => {
    const { till, sql } = makeTill({ firstRun: 'pins', staffPin: '1234', managerPin: '0000' })
    const res = await till.request({ method: 'POST', path: '/api/session', body: { pin: '1234' }, client: '1.1.1.1' })
    expect(res.status).toBe(200)
    expect(typeof res.session).toBe('string')
    expect(res.session!.length).toBeGreaterThan(10)
    sql.close()
  })

  it('strikes are per client', async () => {
    const { till, sql } = makeTill({ firstRun: 'pins', staffPin: '1234', managerPin: '0000' })
    for (let i = 0; i < 8; i++) {
      const r = await till.request({ method: 'POST', path: '/api/session', body: { pin: '9999' }, client: 'a' })
      expect(r.status).toBe(401)
    }
    const locked = await till.request({ method: 'POST', path: '/api/session', body: { pin: '9999' }, client: 'a' })
    expect(locked.status).toBe(429)

    const other = await till.request({ method: 'POST', path: '/api/session', body: { pin: '9999' }, client: 'b' })
    expect(other.status).toBe(401)
    sql.close()
  })

  it('followTablet ends when the session ends', async () => {
    const { till, sql } = makeTill({ firstRun: 'pins', staffPin: '1234', managerPin: '0000' })
    const login = await till.request({ method: 'POST', path: '/api/session', body: { pin: '1234' }, client: 'a' })
    const token = login.session!
    const frames: string[] = []
    let ended = 0
    const stop = till.followTablet(token, (f) => frames.push(f), () => { ended++ })
    expect(frames).toHaveLength(1)

    await till.request({ method: 'POST', path: '/api/session/end', session: token, client: 'a' })
    // Trigger broadcast via an authorized session or another request, or session/end itself triggers broadcast
    expect(ended).toBe(1)
    stop()
    sql.close()
  })

  it('wall frames never carry the secret', async () => {
    const { till, sql } = makeTill()
    till.store.kvSet('checkin_secret', 'TOP_SECRET_VALUE_123')
    till.store.kvSet('checkin_url', 'https://kennko.vercel.app/c')
    till.store.kvSet('clock_skew_ms', '0')
    const frames: string[] = []
    const stop = till.followWall((f) => frames.push(f))
    await new Promise((r) => setTimeout(r, 30))
    expect(frames.length).toBeGreaterThanOrEqual(1)
    for (const f of frames) {
      expect(f).not.toContain('TOP_SECRET_VALUE_123')
    }
    stop()
    sql.close()
  })

  it('csv route returns csv', async () => {
    const { till, sql } = makeTill({ firstRun: 'pins', staffPin: '1234', managerPin: '0000' })
    const login = await till.request({ method: 'POST', path: '/api/session', body: { pin: '1234' }, client: 'a' })
    const res = await till.request({ method: 'GET', path: '/api/report.csv?day=2026-11-22', session: login.session!, client: 'a' })
    expect(res.status).toBe(200)
    expect(res.csv?.filename).toBe('kennko-sales-2026-11-22.csv')
    expect(typeof res.csv?.text).toBe('string')
    sql.close()
  })

  it('resume runs one sync and one wall frame', async () => {
    let pulls = 0
    const fetchFn: typeof fetch = async (url) => {
      if (String(url).includes('/v1/sync/pull')) pulls++
      return new Response(JSON.stringify({}), { status: 503 })
    }
    const { till, files, sql } = makeTill({ fetchFn })
    saveDevice(files, { deviceId: 'd-1', name: 'Counter', token: TOKEN, pairedAt: T, revokedAt: null })
    const frames: string[] = []
    const stop = till.followWall((f) => frames.push(f))
    await new Promise((r) => setTimeout(r, 20))
    const beforeFrames = frames.length
    const beforePulls = pulls

    till.resume()
    await new Promise((r) => setTimeout(r, 30))
    expect(pulls).toBeGreaterThan(beforePulls)
    expect(frames.length).toBeGreaterThan(beforeFrames)
    till.pause()
    stop()
    sql.close()
  })
})
