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
import { loadConfig } from './config.ts'
import { nodeFiles } from './node-files.ts'
import { openNodeSqlite } from './node-sqlite.ts'
import { ensureCertificate, tillNames, type Certificate } from './secure.ts'
import { setupPage } from './setup-page.ts'
import { loadDevice } from '../till/device.ts'
import { loadMenu } from '../till/menu.ts'
import { readSessionCookie, sessionCookie } from '../till/sessions.ts'
import { createTill } from '../till/till.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const DATA = process.env.KENNKO_POS_DATA ? path.resolve(process.env.KENNKO_POS_DATA) : path.join(ROOT, 'data')

const args = process.argv.slice(2)
const DEV = args.includes('--dev')
const portArg = args.indexOf('--port')
const config = loadConfig(ROOT)
const port = portArg >= 0 && Number(args[portArg + 1]) > 0 ? Number(args[portArg + 1]) : config.port

fs.mkdirSync(DATA, { recursive: true })
const files = nodeFiles(DATA)
const sql = openNodeSqlite(path.join(DATA, 'pos.db'))
const baseMenu: Menu = loadMenu(files, Date.now())

const till = createTill({
  sql,
  open: openNodeSqlite,
  files,
  fetch,
  config: {
    staffPin: config.staffPin,
    managerPin: config.managerPin,
    shop: config.shop,
    discounts: config.discounts,
    apiUrl: config.api.url,
    firstRun: 'pins',
  },
  baseMenu,
  host: 'node',
  backup: (snapshot) => {
    try {
      const result = backupDay(snapshot, path.join(DATA, 'backups'), manilaDay(Date.now()), config.backupDir)
      if (result.copyError) console.warn(`  Backup: the copy to ${config.backupDir} failed: ${result.copyError}`)
      return result.copyError
        ? `saved here, but the second copy failed (${result.copyError})`
        : result.copy
          ? `saved here and to ${config.backupDir}`
          : 'saved in data/backups'
    } catch (err: any) {
      console.error(`  Backup failed: ${err.message}`)
      return `FAILED (${err.message})`
    }
  },
  timers: {
    set: ((fn: (...a: any[]) => void, ms?: number) => setTimeout(fn, ms).unref()) as typeof setTimeout,
    clear: clearTimeout,
  },
  log: console.log,
})

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
}

const json = (res: http.ServerResponse, code: number, body: unknown, extra: Record<string, string> = {}) => {
  res.writeHead(code, { 'content-type': MIME['.json'], 'cache-control': 'no-store', ...extra })
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

async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const route = url.pathname
  const secure = cameInSecure(req)
  const session = readSessionCookie(req.headers.cookie, secure)

  if (req.method === 'GET' && route === '/api/wall/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    })
    res.write('retry: 2000\n\n')
    const stop = till.followWall((frame) => res.write(`data: ${frame}\n\n`))
    req.on('close', stop)
    return
  }

  if (req.method === 'GET' && route === '/api/wall/menu') {
    res.writeHead(200, {
      'content-type': MIME['.json'],
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    })
    res.end(`{"menu":${till.wallMenuJson()}}`)
    return
  }

  if (req.method === 'GET' && route === '/api/events') {
    if (!till.canFollow(session)) {
      return json(res, 401, { error: 'Enter your PIN to open the till.' })
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write('retry: 2000\n\n')
    let stop = () => {}
    const keepalive = setInterval(() => res.write(': keepalive\n\n'), 20_000).unref()
    stop = till.followTablet(
      session,
      (frame) => res.write(`data: ${frame}\n\n`),
      () => {
        clearInterval(keepalive)
        res.end()
      },
    )
    req.on('close', () => {
      clearInterval(keepalive)
      stop()
    })
    return
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed.' })
  }

  const body = req.method === 'POST' ? await readBody(req) : undefined
  const reply = await till.request({
    method: req.method,
    path: `${url.pathname}${url.search}`,
    body,
    session,
    client: req.socket.remoteAddress ?? '?',
    secureUrl: secureUrlFor(req),
  })

  if (reply.session !== undefined) {
    res.setHeader('set-cookie', sessionCookie(reply.session, secure))
  }
  if (reply.csv) {
    res.writeHead(reply.status, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${reply.csv.filename}"`,
      'cache-control': 'no-store',
    })
    return res.end(reply.csv.text)
  }
  return json(res, reply.status, reply.body)
}

// ---------- pages ----------
const vite = DEV
  ? await (await import('vite')).createServer({ root: ROOT, server: { middlewareMode: true, hmr: { port: port + 1 } }, appType: 'spa' })
  : null
if (!DEV && !fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('The till screens have not been built yet. Run "npm run build" in apps/pos first, or start with "npm run dev".')
  process.exit(1)
}

// ---------- the secure address ----------
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
  till.start()
  const lan = LAN().map((address) => `http://${address}:${port}/`)
  const shift = till.store.openShift()
  console.log(`\n  KENNKO POS${DEV ? '  (development)' : ''}`)
  console.log(`  This computer:   http://localhost:${port}/`)
  console.log(lan.length ? `  Tablets (wifi):  ${lan.join('   ')}` : '  Tablets: no network found.')
  if (certificate) {
    const named = certificate.names.find((n) => n.endsWith('.local'))
    console.log(`  Install as app:  open ${lan[0] ?? `http://localhost:${port}/`}setup on each tablet, once`)
    console.log(`  Secure address:  ${[...(named ? [named] : []), ...LAN()].map((n) => `https://${n}:${config.securePort}/`).join('   ') || `https://localhost:${config.securePort}/`}`)
  } else if (!DEV) console.log(`  Install as app:  not available. ${secureProblem}`)
  const snap = till.loadedSnapshot()
  console.log(`  Menu:            ${snap ? `from the website, version ${snap.version}` : baseMenu.source === 'website' ? 'from the website (saved before sync)' : 'built-in'}, ${baseMenu.categories.reduce((n, c) => n + c.items.length, 0)} items`)
  console.log(`  Till:            ${shift ? `open, expecting ${formatPesos(till.store.shiftSummary(shift).expectedCashCentavos)} in the drawer` : 'closed'}`)
  console.log(`  Backup:          ${till.lastBackup()}`)
  const device = loadDevice(files)
  console.log(`  Kennko account:  ${device ? (device.revokedAt !== null ? `disconnected in admin (was "${device.name}")` : `connected as "${device.name}"`) : 'not connected (Menu › This till)'}`)
  const s = till.status()
  const waiting = s.pendingEvents ? `, ${s.pendingEvents} change${s.pendingEvents === 1 ? '' : 's'} waiting to send` : ''
  const importing = s.importing ? `, ${s.importing} old record${s.importing === 1 ? '' : 's'} to copy to Kennko` : ''
  const online = till.store.activeOnlineOrders().length
  const queued = online ? `, ${online} online order${online === 1 ? '' : 's'} in the queue` : ''
  console.log(`  Sync:            ${!s.paired ? 'pending (not connected yet)' : s.revoked ? 'stopped (disconnected in admin)' : config.api.url ? 'paired, every 15 s' : 'paired, but the website address is not set'}${waiting}${importing}${queued}`)
  console.log(`  PINs:            ${({ off: 'off', shared: 'shared, from config.json', 'per-person': "each person's own" } as const)[till.pinMode()]}`)
  if (till.pinMode() !== 'per-person' && (config.staffPin === '1234' || config.managerPin === '0000')) console.log('  PINs are still the defaults (staff 1234, manager 0000). Change them in config.json before real use.')
  console.log('  Press Ctrl+C to stop.\n')
})
