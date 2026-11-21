import http from 'node:http'
import { spawn } from 'node:child_process'

const PORT = 4466
const qr21 = Array.from({ length: 21 }, (_, r) =>
  Array.from({ length: 21 }, (_, c) => ((r + c) % 2 === 0 ? '1' : '0')).join(''),
)

function buildFrame() {
  const now = Date.now()
  return JSON.stringify({
    day: '2026-11-22',
    baristas: 2,
    orders: [
      { id: 1, label: '1', status: 'preparing', items: [{ name: 'Café Latte', qty: 1 }], name: 'Maya', createdAt: now - 20_000 },
      { id: 2, label: '2', status: 'serving', items: [{ name: 'Matcha', qty: 1 }], name: 'Leo', createdAt: now - 10_000 },
    ],
    visitors: [
      { key: 'cat-1', name: 'Mochi', look: { coat: 'calico' }, endsAt: now + 60_000 },
    ],
    checkin: {
      url: 'https://kennko.vercel.app/c?c=TEST1234',
      modules: qr21,
      expiresAt: now + 60_000,
    },
    tillNow: now,
  })
}

const clients = new Set()
const server = http.createServer((req, res) => {
  if (req.url === '/api/wall/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    })
    res.write(`retry: 2000\n\ndata: ${buildFrame()}\n\n`)
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }
  res.writeHead(404)
  res.end()
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Probe feed stub listening on http://0.0.0.0:${PORT}/api/wall/events`)
})

setInterval(() => {
  const frame = `data: ${buildFrame()}\n\n`
  for (const res of clients) res.write(frame)
}, 2000)

const dns = spawn('dns-sd', ['-R', 'Kennko POS', '_kennko-pos._tcp', 'local', String(PORT)], { stdio: 'inherit' })
process.on('SIGINT', () => {
  dns.kill()
  server.close()
  process.exit(0)
})
