import { OrderError, isShopOpenNow, manilaDay, parseClosingTime, type Menu, type PrepStatus } from '@kennko/core'
import { currentCheckin, msToNextMinute, storedSkew } from './checkin.ts'
import { checkPinFresh, createPinRefresh, forgetConnection, loadDevice, pairWithApi, saveDevice } from './device.ts'
import type { TillHost, TillRequest, TillResponse } from './host.ts'
import { chargeWithFreeDrink, lookupCustomer } from './kennko-api.ts'
import { fetchApiMenu, loadSnapshot, saveSnapshot, splitSoldOut, tillDiscounts, tillMenu } from './menu.ts'
import { createPinDirectory } from './pins.ts'
import { reportCsv } from './report.ts'
import { createSessions, type Who } from './sessions.ts'
import { createStore } from './store.ts'
import { createSync, syncReady } from './sync.ts'
import { tabletSnapshot } from './tablet-feed.ts'
import { bounded } from './wait.ts'
import { wallMenu, wallSnapshot as wallFeed } from './wall-feed.ts'

class PinError extends Error {
  readonly code: number
  constructor(message: string, code: number) {
    super(message)
    this.code = code
  }
}

const MAX_STRIKES = 8
const LOCK_MS = 5 * 60_000
const PAIR_WAIT_MS = 5_000
const CHECK_WAIT_MS = 10_000
const BACKUP_EVERY_MS = 60 * 60 * 1000
const WALL_EVERY_MS = 20_000

const isDay = (text: string | null): text is string => Boolean(text && /^\d{4}-\d{2}-\d{2}$/.test(text))

export function createTill(host: TillHost) {
  const now = host.now ?? Date.now
  const timers = host.timers ?? {
    set: ((fn: (...a: any[]) => void, ms?: number) => setTimeout(fn, ms)) as typeof setTimeout,
    clear: ((id: any) => clearTimeout(id)) as typeof clearTimeout,
  }
  const log = host.log ?? (() => {})
  const { files, config, baseMenu, fetch: fetchFn } = host

  const store = createStore(host.sql, host.open)
  let loadedSnapshot = loadSnapshot(files)
  const sessions = createSessions(store.db, now)
  const pins = createPinDirectory({
    staffPin: config.staffPin,
    managerPin: config.managerPin,
    staff: () => store.staffCache(),
    perPersonOnly: config.firstRun === 'connect',
  })

  let lastBackup = ''
  function runBackup(): void {
    lastBackup = host.backup((file) => store.snapshot(file))
  }

  const tabletListeners = new Map<() => void, { session: string | undefined; onFrame: (json: string) => void; onEnd: () => void }>()
  const wallListeners = new Set<(json: string) => void>()
  let version = 0

  const menu = (): Menu => tillMenu(loadedSnapshot, baseMenu, new Set(store.soldOut()), now())

  const onMenu = (id: string): boolean => loadedSnapshot
    ? loadedSnapshot.categories.some((c) => c.kind === 'drink' && c.items.some((i) => i.id === id))
    : baseMenu.categories.some((c) => c.items.some((i) => i.id === id))

  function shopDetails(): typeof config.shop {
    let pulled: any = null
    try { pulled = JSON.parse(store.kvGet('shop') ?? 'null') } catch { /* a broken value: config only */ }
    if (!pulled || typeof pulled.name !== 'string' || typeof pulled.address !== 'string') return config.shop
    return { ...config.shop, name: pulled.name, address: pulled.address, phone: typeof pulled.phone === 'string' ? pulled.phone : '' }
  }

  const sync = createSync({
    store,
    sessions,
    pins,
    files,
    apiUrl: config.apiUrl,
    fetchFn,
    now,
    timers,
    onChange: ({ menu: menuChanged, staff, online, status }) => {
      if (menuChanged) loadedSnapshot = loadSnapshot(files)
      if (menuChanged || staff || online || status) broadcast()
    },
  })

  const pinRefresh = createPinRefresh({ files, refresh: sync.runOnce, now })
  const canSync = () => syncReady(loadDevice(files), config.apiUrl)

  const snapshot = () => JSON.stringify(tabletSnapshot(store, {
    version,
    now: now(),
    menuKey: `${loadedSnapshot?.version ?? 0}:${baseMenu.updatedAt}:${store.soldOut().sort().join(',')}`,
    sync: sync.status(),
  }))

  async function wallSnapshot(): Promise<string> {
    const t = now()
    let checkin = null
    try { checkin = await currentCheckin(store, t) } catch { log('  The wall check-in QR could not be made; the wall runs without it.') }
    return JSON.stringify(wallFeed(store, menu(), t, checkin))
  }

  const wallFailed = (err: any) => log(`  The wall feed failed: ${err?.message ?? err}`)

  function sendWall(): void {
    if (!wallListeners.size) return
    wallSnapshot().then((frame) => {
      for (const listener of wallListeners) listener(frame)
    }, wallFailed)
  }

  function broadcast(): void {
    version += 1
    const frame = snapshot()
    const open = pins.mode() === 'off'
    for (const [key, entry] of [...tabletListeners.entries()]) {
      if (!open && !sessions.get(entry.session)) {
        tabletListeners.delete(key)
        entry.onEnd()
        continue
      }
      entry.onFrame(frame)
    }
    sendWall()
  }

  const strikes = new Map<string, { count: number; until: number }>()

  async function checkPin(client: string, given: unknown, need: 'staff' | 'manager'): Promise<Who> {
    const t = now()
    const s = strikes.get(client)
    if (s && s.until > t) throw new PinError('Too many wrong PINs. Try again in 5 minutes.', 429)
    const pin = typeof given === 'string' ? given : ''
    const who = await checkPinFresh(() => (need === 'manager' ? pins.checkManager(pin) : pins.checkGate(pin)), pinRefresh.soon)
    if (who) {
      strikes.delete(client)
      return who
    }
    const latest = strikes.get(client)
    if (latest && latest.until > t) throw new PinError('Too many wrong PINs. Try again in 5 minutes.', 429)
    const count = (latest && latest.until === 0 ? latest.count : 0) + 1
    strikes.set(client, count >= MAX_STRIKES ? { count: 0, until: t + LOCK_MS } : { count, until: 0 })
    throw new PinError(need === 'manager' ? 'Wrong manager PIN.' : 'Wrong PIN.', need === 'manager' ? 403 : 401)
  }

  async function personalPin(client: string, given: unknown): Promise<Who> {
    if (typeof given !== 'string' || given === '') throw new PinError('Enter your own PIN to mark a drink sold out.', 403)
    try {
      return await checkPin(client, given, 'staff')
    } catch (err) {
      if (err instanceof PinError && err.code === 401) throw new PinError('Wrong PIN.', 403)
      throw err
    }
  }

  function needSession(session: string | undefined): Who | null {
    if (pins.mode() === 'off') return null
    const who = sessions.get(session)
    if (!who) throw new PinError('Enter your PIN to open the till.', 401)
    return who
  }

  async function handle(req: TillRequest): Promise<TillResponse> {
    const url = new URL(req.path, 'http://localhost')
    const route = url.pathname
    const t = now()
    const body: any = req.body ?? {}

    if (req.method === 'GET' && route === '/api/bootstrap') {
      const device = loadDevice(files)
      const staff = store.staffCache()
      const hasLead = staff.some((s) => s.role === 'owner' || s.role === 'manager')
      return {
        status: 200,
        body: {
          shop: shopDetails(),
          discounts: tillDiscounts(loadedSnapshot, config.discounts),
          pinMode: pins.mode(),
          websiteConfigured: Boolean(config.apiUrl),
          secureUrl: req.secureUrl ?? null,
          device: device ? { name: device.name, revoked: device.revokedAt !== null } : null,
          syncConfigured: canSync(),
          host: host.host,
          firstRun: config.firstRun,
          noLeads: device !== null && !hasLead,
        },
      }
    }

    if (route === '/api/session') {
      if (req.method === 'GET') {
        const who = sessions.get(req.session)
        if (who) return { status: 200, body: { role: who.role, name: who.name } }
        if (pins.mode() === 'off') return { status: 200, body: { role: 'staff', name: null } }
        throw new PinError('Enter your PIN to open the till.', 401)
      }
      if (req.method === 'POST') {
        if (config.firstRun === 'connect' && loadDevice(files) === null) {
          return { status: 409, body: { error: 'Connect this till first.' } }
        }
        const who = await checkPin(req.client, body.pin, 'staff')
        sessions.end(req.session)
        const token = sessions.start(who)
        return { status: 200, body: { role: who.role, name: who.name }, session: token }
      }
      return { status: 405, body: { error: 'Method not allowed.' } }
    }

    if (config.firstRun === 'connect' && loadDevice(files) === null) {
      if (!(req.method === 'POST' && route === '/api/device/pair')) {
        return { status: 409, body: { error: 'Connect this till first.' } }
      }
    }

    if (req.method === 'POST' && route === '/api/session/end') {
      sessions.end(req.session)
      broadcast()
      return { status: 200, body: { ok: true }, session: null }
    }

    if (req.method === 'POST' && route === '/api/device/pair') {
      const firstConnect = config.firstRun === 'connect' && loadDevice(files) === null
      if (!firstConnect) {
        needSession(req.session)
        await checkPin(req.client, body.managerPin, 'manager')
      }
      if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) throw new OrderError('The code is 6 digits.')
      let device
      try { device = await pairWithApi(config.apiUrl, body.code, t, fetchFn) } catch (err: any) { throw new OrderError(err.message) }
      saveDevice(files, device)
      await bounded(sync.runOnce(), PAIR_WAIT_MS)
      broadcast()
      return { status: 200, body: { name: device.name } }
    }

    const session = needSession(req.session)
    const by = session?.staffId ?? null

    if (req.method === 'GET') {
      if (route === '/api/menu') return { status: 200, body: menu() }
      const lookup = /^\/api\/customers\/([^/]{1,120})$/.exec(route)
      if (lookup) {
        let code = ''
        try { code = decodeURIComponent(lookup[1]!) } catch { /* refused as a typo below */ }
        return { status: 200, body: await lookupCustomer(store, files, config.apiUrl, code, fetchFn) }
      }
      if (route === '/api/orders') {
        const day = url.searchParams.get('day')
        return { status: 200, body: store.ordersForDay(isDay(day) ? day : manilaDay(t)) }
      }
      if (route === '/api/visitors') return { status: 200, body: store.visitorsAt(t) }
      if (route === '/api/shop') {
        const s = store.shopStatus()
        return { status: 200, body: { ...s, openNow: isShopOpenNow(s, t) } }
      }
      if (route === '/api/till') {
        const shift = store.openShift()
        return {
          status: 200,
          body: {
            shift,
            summary: shift ? store.shiftSummary(shift) : null,
            moves: shift ? store.cashMoves(shift.id) : [],
            recent: store.recentShifts(),
          },
        }
      }
      if (route === '/api/report') {
        const day = url.searchParams.get('day')
        const d = isDay(day) ? day : manilaDay(t)
        return { status: 200, body: { day: d, summary: store.daySummary(d) } }
      }
      if (route === '/api/report.csv') {
        const day = url.searchParams.get('day')
        const d = isDay(day) ? day : manilaDay(t)
        return {
          status: 200,
          body: null,
          csv: { filename: `kennko-sales-${d}.csv`, text: reportCsv(store.ordersForDay(d).reverse()) },
        }
      }
      return { status: 404, body: { error: 'Not found.' } }
    }

    if (req.method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } }

    const done = (payload: unknown): TillResponse => {
      broadcast()
      sync.kick()
      return { status: 200, body: payload }
    }

    if (route === '/api/orders') {
      if (body.reward) {
        const manager = await checkPin(req.client, body.managerPin, 'manager')
        return done(await chargeWithFreeDrink({
          store,
          menu: menu(),
          files,
          apiUrl: config.apiUrl,
          fetchFn,
          input: body,
          reward: body.reward,
          now: t,
          by,
          managerStaffId: manager.staffId,
          kick: () => sync.kick(),
        }))
      }
      return done(store.createOrder(menu(), body, t, by))
    }

    const customerAction = /^\/api\/orders\/(\d+)\/(customer|customer\/remove|stamp|cat|table|wall-remove)$/.exec(route)
    if (customerAction) {
      const id = Number(customerAction[1])
      if (customerAction[2] === 'customer') return done(store.linkCustomer(id, body.code, t, by))
      if (customerAction[2] === 'customer/remove') return done(store.unlinkCustomer(id, t, by))
      if (customerAction[2] === 'table') return done(store.setOrderTable(id, body.tableNumber ?? null))
      if (customerAction[2] === 'wall-remove') return done(store.dismissFromWall(id))
      if (customerAction[2] === 'cat') {
        return done(store.setOrderCat(id, body.catLook ?? null, typeof body.customerName === 'string' ? body.customerName : undefined,
          typeof body.visitorKey === 'string' ? body.visitorKey : null, t))
      }
      return done(store.stampOrder(id, t, by))
    }

    const orderAction = /^\/api\/orders\/(\d+)\/(advance|undo|void)$/.exec(route)
    if (orderAction) {
      const id = Number(orderAction[1])
      if (orderAction[2] === 'advance') return done(store.advance(id, t, by))
      if (orderAction[2] === 'undo') return done(store.undo(id, t, by))
      const manager = await checkPin(req.client, body.managerPin, 'manager')
      return done(store.voidOrder(id, body.reason, t, manager.staffId))
    }

    const onlineAction = /^\/api\/online\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(advance|stamp)$/i.exec(route)
    if (onlineAction?.[2] === 'stamp') return done(store.stampOnline(onlineAction[1]!, t, by))
    if (onlineAction) {
      if (typeof body.from !== 'string') throw new OrderError('Reload the till, then try again.')
      return done(store.advanceOnline(onlineAction[1]!, t, by, body.from as PrepStatus))
    }

    const paymentAction = /^\/api\/online\/payment\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(verify|reject)$/i.exec(route)
    if (paymentAction) {
      const device = loadDevice(files)
      if (!device || device.revokedAt !== null || !config.apiUrl) {
        throw new OrderError('Connect this till to Kennko to confirm online payments.')
      }
      const staffId = by ?? store.staffCache()[0]?.id ?? null
      if (!staffId) throw new OrderError('Sign in with a staff PIN to confirm online payments.')
      let r: Response
      try {
        r = await fetchFn(`${config.apiUrl.replace(/\/+$/, '')}/sync/online-payment`, {
          method: 'POST',
          headers: { authorization: `Bearer ${device.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ paymentId: paymentAction[1], decision: paymentAction[2], staffId }),
        })
      } catch {
        throw new OrderError('Connect to the internet to confirm online payments.')
      }
      const data: any = await r.json().catch(() => null)
      if (!r.ok) throw new OrderError(data?.error || 'Could not update payment.')
      if (Array.isArray(data?.pendingPayments)) store.replacePendingPayments(data.pendingPayments)
      if (Array.isArray(data?.onlineOrders)) store.replaceOnlineOrders(data.onlineOrders)
      broadcast()
      return { status: 200, body: { ok: true } }
    }

    if (route === '/api/menu/availability') {
      if (typeof body.itemId !== 'string' || !onMenu(body.itemId)) throw new OrderError('That drink is not on the menu.')
      const credited = pins.mode() === 'per-person' ? (await personalPin(req.client, body.pin)).staffId : by
      store.setAvailable(body.itemId, Boolean(body.available), t, credited, { outbox: loadDevice(files)?.revokedAt === null })
      return done(menu())
    }

    if (route === '/api/menu/sync') {
      if (canSync()) {
        const finished = await bounded(sync.runOnce(), CHECK_WAIT_MS)
        if (!finished) {
          broadcast()
          return { status: 200, body: { ...menu(), notice: 'Still checking — the menu updates by itself.' } }
        }
        const problem = sync.status().problem
        if (problem) throw new OrderError(problem)
        broadcast()
        return { status: 200, body: menu() }
      }
      await checkPin(req.client, body.managerPin, 'manager')
      let pulled
      try { pulled = await fetchApiMenu(config.apiUrl, t, fetchFn) } catch (err: any) { throw new OrderError(err.message) }
      const { snapshot: clean, soldOut } = splitSoldOut(pulled)
      saveSnapshot(files, clean)
      for (const id of soldOut) store.setAvailable(id, false, t, null, { outbox: false })
      loadedSnapshot = clean
      return done(menu())
    }

    if (route === '/api/device/forget') {
      await checkPin(req.client, body.managerPin, 'manager')
      forgetConnection(store, files)
      broadcast()
      return { status: 200, body: { ok: true } }
    }

    if (route === '/api/shop') {
      const cur = store.shopStatus()
      const next = store.setShopStatus({
        isOpen: typeof body.isOpen === 'boolean' ? body.isOpen : cur.isOpen,
        closingTime: body.closingTime === undefined ? cur.closingTime : body.closingTime === null ? null : parseClosingTime(body.closingTime),
        updatedAt: t,
      })
      const device = loadDevice(files)
      if (device && device.revokedAt === null && config.apiUrl) {
        fetchFn(`${config.apiUrl.replace(/\/+$/, '')}/v1/sync/shop`, {
          method: 'PATCH',
          headers: { authorization: `Bearer ${device.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ isOpen: next.isOpen, closingTime: next.closingTime }),
        }).catch(() => {})
      }
      broadcast()
      return { status: 200, body: { ...next, openNow: isShopOpenNow(next, t) } }
    }

    if (route === '/api/till/open') {
      const opened = store.startShift(body.floatCentavos, t, by)
      const cur = store.shopStatus()
      if (!isShopOpenNow(cur, t)) {
        const next = store.setShopStatus({ ...cur, isOpen: true, updatedAt: t })
        const device = loadDevice(files)
        if (device && device.revokedAt === null && config.apiUrl) {
          fetchFn(`${config.apiUrl.replace(/\/+$/, '')}/v1/sync/shop`, {
            method: 'PATCH',
            headers: { authorization: `Bearer ${device.token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ isOpen: true }),
          }).catch(() => {})
        }
      }
      return done(opened)
    }
    if (route === '/api/till/cash') {
      const credited = body.kind === 'out' ? (await checkPin(req.client, body.managerPin, 'manager')).staffId : by
      return done(store.cashMove(body.kind, body.amountCentavos, body.reason, t, credited))
    }
    if (route === '/api/till/close') {
      const manager = await checkPin(req.client, body.managerPin, 'manager')
      const closed = store.endShift(body.countedCentavos, body.note, t, manager.staffId)
      const cur = store.shopStatus()
      const next = store.setShopStatus({ ...cur, isOpen: false, updatedAt: t })
      const device = loadDevice(files)
      if (device && device.revokedAt === null && config.apiUrl) {
        fetchFn(`${config.apiUrl.replace(/\/+$/, '')}/v1/sync/shop`, {
          method: 'PATCH',
          headers: { authorization: `Bearer ${device.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ isOpen: false }),
        }).catch(() => {})
      }
      runBackup()
      return done(closed)
    }

    return { status: 404, body: { error: 'Not found.' } }
  }

  let backupTimer: ReturnType<typeof setTimeout> | null = null
  let wallTimer: ReturnType<typeof setTimeout> | null = null
  let minuteTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleBackup(): void {
    backupTimer = timers.set(() => {
      runBackup()
      scheduleBackup()
    }, BACKUP_EVERY_MS)
  }

  function scheduleWall(): void {
    wallTimer = timers.set(() => {
      sendWall()
      scheduleWall()
    }, WALL_EVERY_MS)
  }

  function scheduleMinute(): void {
    minuteTimer = timers.set(() => {
      sendWall()
      scheduleMinute()
    }, msToNextMinute(now(), storedSkew(store) ?? 0) + 50)
  }

  return {
    async request(req: TillRequest): Promise<TillResponse> {
      try {
        return await handle(req)
      } catch (err: any) {
        if (err instanceof PinError) return { status: err.code, body: { error: err.message } }
        if (err instanceof OrderError) return { status: 400, body: { error: err.message } }
        throw err
      }
    },
    canFollow: (session?: string): boolean => pins.mode() === 'off' || Boolean(sessions.get(session)),
    followTablet(session: string | undefined, onFrame: (json: string) => void, onEnd: () => void): () => void {
      const key = () => {}
      tabletListeners.set(key, { session, onFrame, onEnd })
      onFrame(snapshot())
      return () => { tabletListeners.delete(key) }
    },
    followWall(onFrame: (json: string) => void): () => void {
      wallListeners.add(onFrame)
      wallSnapshot().then((frame) => {
        if (wallListeners.has(onFrame)) onFrame(frame)
      }, wallFailed)
      return () => { wallListeners.delete(onFrame) }
    },
    wallMenuJson: (): string => JSON.stringify(wallMenu(menu())),
    start(): void {
      runBackup()
      scheduleBackup()
      sync.start()
      scheduleWall()
      scheduleMinute()
    },
    pause(): void {
      sync.stop()
      if (backupTimer !== null) { timers.clear(backupTimer); backupTimer = null }
      if (wallTimer !== null) { timers.clear(wallTimer); wallTimer = null }
      if (minuteTimer !== null) { timers.clear(minuteTimer); minuteTimer = null }
    },
    resume(): void {
      sync.runOnce()
      sendWall()
      sync.start()
      if (backupTimer === null) scheduleBackup()
      if (wallTimer === null) scheduleWall()
      if (minuteTimer === null) scheduleMinute()
    },
    status: () => sync.status(),
    lastBackup: () => lastBackup,
    pinMode: () => pins.mode(),
    loadedSnapshot: () => loadedSnapshot,
    store,
  }
}

export type Till = ReturnType<typeof createTill>
