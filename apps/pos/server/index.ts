#!/usr/bin/env node
// Kennko POS: the till. Runs on a computer in the shop; tablets open it over the cafe wifi.
// Sales are kept in a local database, so the till keeps working when the internet is down.
// Usage: tsx server/index.ts [--dev] [--port N]
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { OrderError, formatPesos, manilaDay, type Menu } from '@kennko/core'
import { backupDay } from './backup.ts'
import { ensureCertificate, tillNames, type Certificate } from './secure.ts'
import { setupPage } from './setup-page.ts'
import { loadConfig } from './config.ts'
import { fetchApiMenu, loadMenu, loadSnapshot, saveSnapshot, tillDiscounts, tillMenu } from './menu.ts'
import { createStore } from './store.ts'
import { createPinDirectory } from './pins.ts'
import { checkPinFresh, createPinRefresh, forgetDevice, loadDevice, pairWithApi, saveDevice } from './device.ts'
import { createSync } from './sync.ts'
import { createSessions, readSessionCookie, sessionCookie, type Who } from './sessions.ts'
import { reportCsv } from './report.ts'
import { WALL_LINGER_MS, wallOrders } from './wall-feed.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const DATA = process.env.KENNKO_POS_DATA ? path.resolve(process.env.KENNKO_POS_DATA) : path.join(ROOT, 'data')

const args = process.argv.slice(2)
const DEV = args.includes('--dev')
const portArg = args.indexOf('--port')
const config = loadConfig(ROOT)
const port = portArg >= 0 && Number(args[portArg + 1]) > 0 ? Number(args[portArg + 1]) : config.port

fs.mkdirSync(DATA, { recursive: true })
const store = createStore(path.join(DATA, 'pos.db'))
// The menu.json from before sync (or the built-in menu): used only until a snapshot has been pulled.
const baseMenu: Menu = loadMenu(DATA, Date.now())
// The snapshot pulled from the website (data/menu-snapshot.json); reloaded whenever the sync saves a newer one.
let loadedSnapshot = loadSnapshot(DATA)
// The PIN is typed once per browser and swapped for a session cookie; sessions live in pos.db and survive a restart.
const sessions = createSessions(store.db, () => Date.now())
// Each person's own PIN, checked against the staff cache in pos.db (filled by the sync's pull below).
const pins = createPinDirectory({ staffPin: config.staffPin, managerPin: config.managerPin, staff: () => store.staffCache() })

/** Copies the sales database to data/backups (and to config.backupDir when set). Never throws: a failed backup must not stop a sale. */
let lastBackup = ''
function backup(): void {
  try {
    const result = backupDay((file) => store.snapshot(file), path.join(DATA, 'backups'), manilaDay(Date.now()), config.backupDir)
    lastBackup = result.copyError ? `saved here, but the second copy failed (${result.copyError})` : result.copy ? `saved here and to ${config.backupDir}` : 'saved in data/backups'
    if (result.copyError) console.warn(`  Backup: the copy to ${config.backupDir} failed: ${result.copyError}`)
  } catch (err: any) {
    lastBackup = `FAILED (${err.message})`
    console.error(`  Backup failed: ${err.message}`)
  }
}
backup()
setInterval(backup, 60 * 60 * 1000).unref()

/**
 * The sync with the Kennko API (sync.ts): imports old history once, pushes the outbox, pulls the menu, sold-out marks,
 * staff and shop details. It runs in the background; no request waits on it except pairing, "Check now" and the
 * bounded wrong-PIN refresh. Every write kicks it after answering.
 */
const sync = createSync({
  store, sessions, pins, dataDir: DATA, apiUrl: config.api.url,
  onChange: ({ menu: menuChanged }) => {
    if (menuChanged) loadedSnapshot = loadSnapshot(DATA)
    broadcast()
  },
})
// A PIN that matches no one runs one sync (paired, not revoked, at most every 30 s, waiting at most 2.5 s; Ruling P4-1).
const pinRefresh = createPinRefresh({ dataDir: DATA, refresh: sync.runOnce })

/** The menu the till sells from: the pulled snapshot (else the old menu) with the sold-out marks applied. */
const menu = (): Menu => tillMenu(loadedSnapshot, baseMenu, new Set(store.soldOut()), Date.now())

/** True when a drink id is on the till's menu, sold out or not. */
const onMenu = (id: string): boolean => loadedSnapshot
  ? loadedSnapshot.categories.some((c) => c.kind === 'drink' && c.items.some((i) => i.id === id))
  : baseMenu.categories.some((c) => c.items.some((i) => i.id === id))

/** The shop details: config.json's, with name, address and phone from the website once pulled (Ruling 12). */
function shopDetails(): typeof config.shop {
  let pulled: any = null
  try { pulled = JSON.parse(store.kvGet('shop') ?? 'null') } catch { /* a broken value: config only */ }
  if (!pulled || typeof pulled.name !== 'string' || typeof pulled.address !== 'string') return config.shop
  return { ...config.shop, name: pulled.name, address: pulled.address, phone: typeof pulled.phone === 'string' ? pulled.phone : '' }
}

// ---------- live updates ----------
// Each tablet's feed remembers its session token, so a feed whose session has ended is closed (see broadcast).
const clients = new Map<http.ServerResponse, string | undefined>()
let version = 0
// menuKey changes whenever the menu or a sold-out mark does, so every tablet knows to fetch it again.
const snapshot = () => JSON.stringify({
  version, now: Date.now(), day: manilaDay(Date.now()), active: store.activeOrders(), shift: store.openShift(),
  menuKey: `${loadedSnapshot?.version ?? 0}:${baseMenu.updatedAt}:${store.soldOut().sort().join(',')}`,
  sync: sync.status(),
})
// The projector wall follows the till through its own feed: drink names and steps only, so it needs no PIN.
const wallClients = new Set<http.ServerResponse>()
const wallSnapshot = () => {
  const now = Date.now()
  return JSON.stringify({ now, day: manilaDay(now), orders: wallOrders([...store.activeOrders(), ...store.recentlyFinished(now - WALL_LINGER_MS)]) })
}
function broadcast() {
  version += 1
  const frame = `data: ${snapshot()}\n\n`
  const open = pins.mode() === 'off'
  for (const [res, token] of clients) {
    // A session ended by Lock elsewhere or by a staff refresh: close the feed so that tablet asks for a PIN.
    if (!open && !sessions.get(token)) { clients.delete(res); res.end(); continue }
    res.write(frame)
  }
  const wallFrame = `data: ${wallSnapshot()}\n\n`
  for (const res of wallClients) res.write(wallFrame)
}
setInterval(() => { for (const res of clients.keys()) res.write(': keepalive\n\n') }, 20000).unref()
// Re-sent on a timer too, so a finished order drops off the wall once its cat has had time to leave.
setInterval(() => { if (wallClients.size) { const frame = `data: ${wallSnapshot()}\n\n`; for (const res of wallClients) res.write(frame) } }, 20000).unref()

// ---------- helpers ----------
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
}

const json = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': MIME['.json'], 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 65536) { reject(new OrderError('Request too large.')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { reject(new OrderError('Bad request.')) }
    })
    req.on('error', reject)
  })
}

// PINs are short, so wrong guesses lock that device out for a while.
class PinError extends Error {
  constructor(message: string, readonly code: number) { super(message) }
}
const strikes = new Map<string, { count: number; until: number }>()
const MAX_STRIKES = 8
const LOCK_MS = 5 * 60000

/**
 * Checks a typed PIN: the one that opens the till, or the manager PIN. A PIN that matches no one first runs one sync
 * for the staff list (throttled, at most 2.5 s) and is checked once more; the whole try counts as one wrong guess.
 */
async function checkPin(req: http.IncomingMessage, given: unknown, need: 'staff' | 'manager'): Promise<Who> {
  const ip = req.socket.remoteAddress ?? '?'
  const s = strikes.get(ip)
  if (s && s.until > Date.now()) throw new PinError('Too many wrong PINs. Try again in 5 minutes.', 429)
  const pin = typeof given === 'string' ? given : ''
  const who = await checkPinFresh(() => (need === 'manager' ? pins.checkManager(pin) : pins.checkGate(pin)), pinRefresh.soon)
  if (who) {
    strikes.delete(ip)
    return who
  }
  const latest = strikes.get(ip)
  if (latest && latest.until > Date.now()) throw new PinError('Too many wrong PINs. Try again in 5 minutes.', 429)
  const count = (latest && latest.until === 0 ? latest.count : 0) + 1
  strikes.set(ip, count >= MAX_STRIKES ? { count: 0, until: Date.now() + LOCK_MS } : { count, until: 0 })
  throw new PinError(need === 'manager' ? 'Wrong manager PIN.' : 'Wrong PIN.', need === 'manager' ? 403 : 401)
}

/**
 * A person's own PIN for crediting an action (a sold-out mark, Ruling 14), on top of the session. Wrong answers 403,
 * not 401: a 401 would lock the tablet as if its session had ended. A missing PIN is no guess and takes no strike.
 */
async function personalPin(req: http.IncomingMessage, given: unknown): Promise<Who> {
  if (typeof given !== 'string' || given === '') throw new PinError('Enter your own PIN to mark a drink sold out.', 403)
  try {
    return await checkPin(req, given, 'staff')
  } catch (err) {
    if (err instanceof PinError && err.code === 401) throw new PinError('Wrong PIN.', 403)
    throw err
  }
}

/**
 * The session this request carries, or a 401 so the device shows the PIN screen. Off mode needs none and gives null.
 * Its `staffId` is who a sale, shift open, cash in or prep step is credited to (null in shared mode; Ruling 15).
 */
function needSession(req: http.IncomingMessage): Who | null {
  if (pins.mode() === 'off') return null
  const who = sessions.get(readSessionCookie(req.headers.cookie, cameInSecure(req)))
  if (!who) throw new PinError('Enter your PIN to open the till.', 401)
  return who
}

/** Secure cookies only on the https port, or plain-http tablets would never send them back. */
const cameInSecure = (req: http.IncomingMessage) => req.socket instanceof tls.TLSSocket

function inside(base: string, rel: string): string | null {
  let decoded: string
  try { decoded = decodeURIComponent(rel) } catch { return null }
  if (decoded.includes('\0')) return null
  const full = path.resolve(base, `.${path.sep}${decoded}`)
  return full === base || full.startsWith(base + path.sep) ? full : null
}

function sendFile(res: http.ServerResponse, file: string, cache: string) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found') }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': cache })
    res.end(data)
  })
}

const isDay = (text: string | null): text is string => Boolean(text && /^\d{4}-\d{2}-\d{2}$/.test(text))

// ---------- api ----------
async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const route = url.pathname
  const now = Date.now()

  if (req.method === 'GET' && route === '/api/bootstrap') {
    const device = loadDevice(DATA)
    return json(res, 200, {
      shop: shopDetails(), discounts: tillDiscounts(loadedSnapshot, config.discounts), pinMode: pins.mode(),
      websiteConfigured: Boolean(config.api.url), secureUrl: secureUrlFor(req),
      device: device ? { name: device.name, revoked: device.revokedAt !== null } : null,
      // Paired, not revoked and the website address set: the menu screen offers "Check now" (one sync, no PIN).
      syncConfigured: Boolean(config.api.url) && device !== null && device.revokedAt === null,
    })
  }
  if (req.method === 'GET' && route === '/api/wall/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write(`retry: 2000\n\ndata: ${wallSnapshot()}\n\n`)
    wallClients.add(res)
    req.on('close', () => wallClients.delete(res))
    return
  }
  if (route === '/api/session') {
    if (req.method === 'GET') {
      const who = sessions.get(readSessionCookie(req.headers.cookie, cameInSecure(req)))
      if (who) return json(res, 200, { role: who.role, name: who.name })
      if (pins.mode() === 'off') return json(res, 200, { role: 'staff', name: null })
      throw new PinError('Enter your PIN to open the till.', 401)
    }
    if (req.method === 'POST') {
      const body = await readBody(req)
      const who = await checkPin(req, body.pin, 'staff')
      sessions.end(readSessionCookie(req.headers.cookie, cameInSecure(req)))
      const token = sessions.start(who)
      res.setHeader('set-cookie', sessionCookie(token, cameInSecure(req)))
      return json(res, 200, { role: who.role, name: who.name })
    }
    return json(res, 405, { error: 'Method not allowed.' })
  }
  if (req.method === 'POST' && route === '/api/session/end') {
    sessions.end(readSessionCookie(req.headers.cookie, cameInSecure(req)))
    res.setHeader('set-cookie', sessionCookie(null, cameInSecure(req)))
    return json(res, 200, { ok: true })
  }

  // Everything below needs a session (the cookie rides along on fetch, EventSource and the CSV link alike).
  const session = needSession(req)
  const by = session?.staffId ?? null

  if (req.method === 'GET') {
    if (route === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write(`retry: 2000\n\ndata: ${snapshot()}\n\n`)
      clients.set(res, readSessionCookie(req.headers.cookie, cameInSecure(req)))
      req.on('close', () => clients.delete(res))
      return
    }
    if (route === '/api/menu') return json(res, 200, menu())
    if (route === '/api/orders') {
      const day = url.searchParams.get('day')
      return json(res, 200, store.ordersForDay(isDay(day) ? day : manilaDay(now)))
    }
    if (route === '/api/till') {
      const shift = store.openShift()
      return json(res, 200, {
        shift,
        summary: shift ? store.shiftSummary(shift) : null,
        moves: shift ? store.cashMoves(shift.id) : [],
        recent: store.recentShifts(),
      })
    }
    if (route === '/api/report') {
      const day = url.searchParams.get('day')
      const d = isDay(day) ? day : manilaDay(now)
      return json(res, 200, { day: d, summary: store.daySummary(d) })
    }
    if (route === '/api/report.csv') {
      const day = url.searchParams.get('day')
      const d = isDay(day) ? day : manilaDay(now)
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="kennko-sales-${d}.csv"`, 'cache-control': 'no-store' })
      return res.end(reportCsv(store.ordersForDay(d).reverse()))
    }
    return json(res, 404, { error: 'Not found.' })
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' })
  const body = await readBody(req)
  // Every successful write: tell the tablets, answer, then nudge the sync (it never runs on the request's time).
  const done = (payload: unknown) => { broadcast(); json(res, 200, payload); sync.kick() }

  if (route === '/api/orders') return done(store.createOrder(menu(), body, now, by))

  const orderAction = /^\/api\/orders\/(\d+)\/(advance|undo|void)$/.exec(route)
  if (orderAction) {
    const id = Number(orderAction[1])
    if (orderAction[2] === 'advance') return done(store.advance(id, now, by))
    if (orderAction[2] === 'undo') return done(store.undo(id, now, by))
    const manager = await checkPin(req, body.managerPin, 'manager')
    return done(store.voidOrder(id, body.reason, now, manager.staffId))
  }

  if (route === '/api/menu/availability') {
    if (typeof body.itemId !== 'string' || !onMenu(body.itemId)) throw new OrderError('That drink is not on the menu.')
    // Per-person mode asks for the person's own PIN (any role) and credits them; otherwise the session (Ruling 14/15).
    const credited = pins.mode() === 'per-person' ? (await personalPin(req, body.pin)).staffId : by
    // Sent to Kennko only while connected and not disconnected in admin (Ruling 14).
    store.setAvailable(body.itemId, Boolean(body.available), now, credited, { outbox: loadDevice(DATA)?.revokedAt === null })
    return done(menu())
  }
  if (route === '/api/menu/sync') {
    const device = loadDevice(DATA)
    if (device && device.revokedAt === null) {
      // "Check now" (Ruling 11): one sync, no PIN. The pulled menu has already been applied by onChange.
      await sync.runOnce()
      const problem = sync.status().problem
      if (problem) throw new OrderError(problem)
      return done(menu())
    }
    // Not connected: the manager-PIN pull of the published menu, saved as the snapshot.
    await checkPin(req, body.managerPin, 'manager')
    let pulled
    try { pulled = await fetchApiMenu(config.api.url, now) } catch (err: any) { throw new OrderError(err.message) }
    saveSnapshot(DATA, pulled)
    loadedSnapshot = pulled
    return done(menu())
  }

  if (route === '/api/device/pair') {
    await checkPin(req, body.managerPin, 'manager')
    if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) throw new OrderError('The code is 6 digits.')
    let device
    try { device = await pairWithApi(config.api.url, body.code, now) } catch (err: any) { throw new OrderError(err.message) }
    saveDevice(DATA, device)
    await sync.runOnce()
    broadcast()
    return json(res, 200, { name: device.name })
  }
  if (route === '/api/device/forget') {
    await checkPin(req, body.managerPin, 'manager')
    forgetDevice(DATA) // the staff cache stays, so the same PINs keep working
    broadcast() // the tablets' sync status now says not connected
    return json(res, 200, { ok: true })
  }

  if (route === '/api/till/open') return done(store.startShift(body.floatCentavos, now, by))
  if (route === '/api/till/cash') {
    // Cash in is credited to the session; cash out to the manager who approved it (Ruling 15).
    const credited = body.kind === 'out' ? (await checkPin(req, body.managerPin, 'manager')).staffId : by
    return done(store.cashMove(body.kind, body.amountCentavos, body.reason, now, credited))
  }
  if (route === '/api/till/close') {
    const manager = await checkPin(req, body.managerPin, 'manager')
    const closed = store.endShift(body.countedCentavos, body.note, now, manager.staffId)
    backup()
    return done(closed)
  }
  return json(res, 404, { error: 'Not found.' })
}

// ---------- pages ----------
// In development Vite serves the screens with live reload; in the shop the built files are served as they are.
const vite = DEV
  ? await (await import('vite')).createServer({ root: ROOT, server: { middlewareMode: true, hmr: { port: port + 1 } }, appType: 'spa' })
  : null
if (!DEV && !fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('The till screens have not been built yet. Run "npm run build" in apps/pos first, or start with "npm run dev".')
  process.exit(1)
}

// ---------- the secure address ----------
// Installing the till as an app only works over https, so the till makes its own certificate (see secure.ts).
// Not in development: Vite's live reload talks over plain ws, which a secure page refuses.
const LAN = () => Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i!.address)
let certificate: Certificate | null = null
let secureProblem = ''
if (DEV) secureProblem = 'The secure address is off while developing. Use "npm run pos:start".'
else if (!config.securePort) secureProblem = 'The secure address is turned off in config.json (securePort is 0).'
else {
  const made = ensureCertificate(path.join(DATA, 'cert'), tillNames(LAN(), os.hostname()))
  if ('error' in made) secureProblem = `The till could not make its certificate: ${made.error}.`
  else certificate = made
}
let secureUp = false

/** The https address for whoever is asking, using the same name they reached the till by. */
function secureUrlFor(req: http.IncomingMessage): string | null {
  if (!certificate || !secureUp) return null
  let host = ''
  try { host = new URL(`http://${req.headers.host}`).hostname.toLowerCase() } catch { /* odd Host header */ }
  const name = certificate.names.includes(host) ? host : certificate.names.find((n) => /^\d/.test(n) && n !== '127.0.0.1') ?? 'localhost'
  return `https://${name}:${config.securePort}/`
}

const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (req.method === 'GET' && url.pathname === '/setup') {
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' })
    return res.end(setupPage(secureUrlFor(req), secureProblem))
  }
  if (req.method === 'GET' && url.pathname === '/kennko-pos.crt') {
    if (!certificate) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found') }
    res.writeHead(200, { 'content-type': 'application/x-x509-ca-cert', 'content-disposition': 'attachment; filename="kennko-pos.crt"', 'cache-control': 'no-store' })
    return res.end(fs.readFileSync(certificate.caFile))
  }
  if (url.pathname.startsWith('/api/')) {
    try {
      await api(req, res, url)
    } catch (err: any) {
      if (err instanceof PinError) return json(res, err.code, { error: err.message })
      if (err instanceof OrderError) return json(res, 400, { error: err.message })
      console.error(err)
      if (!res.headersSent) json(res, 500, { error: 'Something went wrong on the till computer.' })
      else res.destroy()
    }
    return
  }
  if (vite) return vite.middlewares(req, res)
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end() }
  const file = inside(DIST, url.pathname.slice(1))
  if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
    return sendFile(res, file, url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
  }
  sendFile(res, path.join(DIST, 'index.html'), 'no-cache')
}

const server = http.createServer(handle)
if (certificate) {
  const secure = https.createServer({ key: certificate.key, cert: certificate.cert }, handle)
  secure.on('error', (err: any) => {
    secureUp = false
    secureProblem = err.code === 'EADDRINUSE' ? `Port ${config.securePort} is already in use; set another securePort in config.json.` : err.message
    console.error(`  Secure address: ${secureProblem}`)
  })
  secure.listen(config.securePort, '0.0.0.0', () => { secureUp = true })
}

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. The till may already be running; otherwise start with --port <number>.`)
  else console.error(err.message)
  process.exit(1)
})

server.listen(port, '0.0.0.0', () => {
  sync.start()
  const lan = LAN().map((address) => `http://${address}:${port}/`)
  const shift = store.openShift()
  console.log(`\n  KENNKO POS${DEV ? '  (development)' : ''}`)
  console.log(`  This computer:   http://localhost:${port}/`)
  console.log(lan.length ? `  Tablets (wifi):  ${lan.join('   ')}` : '  Tablets: no network found.')
  if (certificate) {
    const named = certificate.names.find((n) => n.endsWith('.local'))
    console.log(`  Install as app:  open ${lan[0] ?? `http://localhost:${port}/`}setup on each tablet, once`)
    console.log(`  Secure address:  ${[...(named ? [named] : []), ...LAN()].map((n) => `https://${n}:${config.securePort}/`).join('   ') || `https://localhost:${config.securePort}/`}`)
  } else if (!DEV) console.log(`  Install as app:  not available. ${secureProblem}`)
  const startMenu = menu()
  console.log(`  Menu:            ${loadedSnapshot ? `from the website, version ${loadedSnapshot.version}` : startMenu.source === 'website' ? 'from the website (saved before sync)' : 'built-in'}, ${startMenu.categories.reduce((n, c) => n + c.items.length, 0)} drinks`)
  console.log(`  Till:            ${shift ? `open, expecting ${formatPesos(store.shiftSummary(shift).expectedCashCentavos)} in the drawer` : 'closed'}`)
  console.log(`  Backup:          ${lastBackup}`)
  const device = loadDevice(DATA)
  console.log(`  Kennko account:  ${device ? (device.revokedAt !== null ? `disconnected in admin (was "${device.name}")` : `connected as "${device.name}"`) : 'not connected (Menu › This till)'}`)
  const s = sync.status()
  const waiting = s.pendingEvents ? `, ${s.pendingEvents} change${s.pendingEvents === 1 ? '' : 's'} waiting to send` : ''
  const importing = s.importing ? `, ${s.importing} old record${s.importing === 1 ? '' : 's'} to copy to Kennko` : ''
  console.log(`  Sync:            ${!s.paired ? 'pending (not connected yet)' : s.revoked ? 'stopped (disconnected in admin)' : config.api.url ? 'paired, every 15 s' : 'paired, but the website address is not set'}${waiting}${importing}`)
  console.log(`  PINs:            ${({ off: 'off', shared: 'shared, from config.json', 'per-person': "each person's own" } as const)[pins.mode()]}`)
  if (pins.mode() !== 'per-person' && (config.staffPin === '1234' || config.managerPin === '0000')) console.log('  PINs are still the defaults (staff 1234, manager 0000). Change them in config.json before real use.')
  console.log('  Press Ctrl+C to stop.\n')
})
