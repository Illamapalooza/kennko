#!/usr/bin/env node
// Kennko POS: the till. Runs on a computer in the shop; tablets open it over the cafe wifi.
// Sales are kept in a local database, so the till keeps working when the internet is down.
// Usage: tsx server/index.ts [--dev] [--port N]
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { OrderError, formatPesos, manilaDay, type Menu } from '@kennko/core'
import { loadConfig } from './config.ts'
import { fetchWebsiteMenu, loadMenu, saveMenu } from './menu.ts'
import { createStore } from './store.ts'
import { reportCsv } from './report.ts'
import { WALL_LINGER_MS, wallOrders } from './wall-feed.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = path.resolve(ROOT, '../..')
const DIST = path.join(ROOT, 'dist')
const DATA = process.env.KENNKO_POS_DATA ? path.resolve(process.env.KENNKO_POS_DATA) : path.join(ROOT, 'data')

const args = process.argv.slice(2)
const DEV = args.includes('--dev')
const portArg = args.indexOf('--port')
const config = loadConfig(ROOT, REPO)
const port = portArg >= 0 && Number(args[portArg + 1]) > 0 ? Number(args[portArg + 1]) : config.port

fs.mkdirSync(DATA, { recursive: true })
const store = createStore(path.join(DATA, 'pos.db'))
let baseMenu: Menu = loadMenu(DATA, Date.now())

/** The menu the till sells from: the saved menu with today's sold-out marks applied. */
function menu(): Menu {
  const soldOut = new Set(store.soldOut())
  return {
    ...baseMenu,
    categories: baseMenu.categories.map((c) => ({
      ...c,
      items: c.items.map((i) => (soldOut.has(i.id) ? { ...i, isAvailable: false } : i)),
    })),
  }
}

// ---------- live updates ----------
const clients = new Set<http.ServerResponse>()
let version = 0
// menuKey changes whenever the menu or a sold-out mark does, so every tablet knows to fetch it again.
const snapshot = () => JSON.stringify({
  version, now: Date.now(), day: manilaDay(Date.now()), active: store.activeOrders(), shift: store.openShift(),
  menuKey: `${baseMenu.updatedAt}:${store.soldOut().sort().join(',')}`,
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
  for (const res of clients) res.write(frame)
  const wallFrame = `data: ${wallSnapshot()}\n\n`
  for (const res of wallClients) res.write(wallFrame)
}
setInterval(() => { for (const res of clients) res.write(': keepalive\n\n') }, 20000).unref()
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

function checkPin(req: http.IncomingMessage, given: unknown, need: 'staff' | 'manager'): 'staff' | 'manager' {
  const ip = req.socket.remoteAddress ?? '?'
  const s = strikes.get(ip)
  if (s && s.until > Date.now()) throw new PinError('Too many wrong PINs. Try again in 5 minutes.', 429)
  const pin = typeof given === 'string' ? given : ''
  const isManager = pin === config.managerPin
  const isStaff = isManager || pin === config.staffPin
  if (need === 'manager' ? isManager : isStaff) {
    strikes.delete(ip)
    return isManager ? 'manager' : 'staff'
  }
  const count = (s && s.until === 0 ? s.count : 0) + 1
  strikes.set(ip, count >= MAX_STRIKES ? { count: 0, until: Date.now() + LOCK_MS } : { count, until: 0 })
  throw new PinError(need === 'manager' ? 'Wrong manager PIN.' : 'Wrong PIN.', need === 'manager' ? 403 : 401)
}

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
    return json(res, 200, { shop: config.shop, discounts: config.discounts, pinRequired: Boolean(config.staffPin), websiteConfigured: Boolean(config.website.url && config.website.anonKey) })
  }
  if (req.method === 'GET' && route === '/api/wall/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write(`retry: 2000\n\ndata: ${wallSnapshot()}\n\n`)
    wallClients.add(res)
    req.on('close', () => wallClients.delete(res))
    return
  }
  if (req.method === 'POST' && route === '/api/pin') {
    const body = await readBody(req)
    return json(res, 200, { ok: true, role: checkPin(req, body.pin, 'staff') })
  }

  // Everything below needs the staff PIN. EventSource cannot send headers, so it may ride in the query.
  checkPin(req, req.headers['x-pin'] ?? url.searchParams.get('pin') ?? '', 'staff')

  if (req.method === 'GET') {
    if (route === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write(`retry: 2000\n\ndata: ${snapshot()}\n\n`)
      clients.add(res)
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
  const done = (payload: unknown) => { broadcast(); return json(res, 200, payload) }

  if (route === '/api/orders') return done(store.createOrder(menu(), body, now))

  const orderAction = /^\/api\/orders\/(\d+)\/(advance|undo|void)$/.exec(route)
  if (orderAction) {
    const id = Number(orderAction[1])
    if (orderAction[2] === 'advance') return done(store.advance(id, now))
    if (orderAction[2] === 'undo') return done(store.undo(id, now))
    checkPin(req, body.managerPin, 'manager')
    return done(store.voidOrder(id, body.reason, now))
  }

  if (route === '/api/menu/availability') {
    if (typeof body.itemId !== 'string' || !baseMenu.categories.some((c) => c.items.some((i) => i.id === body.itemId))) {
      throw new OrderError('That drink is not on the menu.')
    }
    store.setAvailable(body.itemId, Boolean(body.available))
    return done(menu())
  }
  if (route === '/api/menu/sync') {
    checkPin(req, body.managerPin, 'manager')
    try { baseMenu = await fetchWebsiteMenu(config.website, now) } catch (err: any) { throw new OrderError(err.message) }
    saveMenu(DATA, baseMenu)
    return done(menu())
  }

  if (route === '/api/till/open') return done(store.startShift(body.floatCentavos, now))
  if (route === '/api/till/cash') {
    if (body.kind === 'out') checkPin(req, body.managerPin, 'manager')
    return done(store.cashMove(body.kind, body.amountCentavos, body.reason, now))
  }
  if (route === '/api/till/close') {
    checkPin(req, body.managerPin, 'manager')
    return done(store.endShift(body.countedCentavos, body.note, now))
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
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
})

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. The till may already be running; otherwise start with --port <number>.`)
  else console.error(err.message)
  process.exit(1)
})

server.listen(port, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i!.address}:${port}/`)
  const shift = store.openShift()
  console.log(`\n  KENNKO POS${DEV ? '  (development)' : ''}`)
  console.log(`  This computer:   http://localhost:${port}/`)
  console.log(lan.length ? `  Tablets (wifi):  ${lan.join('   ')}` : '  Tablets: no network found.')
  console.log(`  Menu:            ${baseMenu.source === 'website' ? 'from the website' : 'built-in'}, ${baseMenu.categories.reduce((n, c) => n + c.items.length, 0)} drinks`)
  console.log(`  Till:            ${shift ? `open, expecting ${formatPesos(store.shiftSummary(shift).expectedCashCentavos)} in the drawer` : 'closed'}`)
  if (config.staffPin === '1234' || config.managerPin === '0000') console.log('  PINs are still the defaults (staff 1234, manager 0000). Change them in config.json before real use.')
  console.log('  Press Ctrl+C to stop.\n')
})
