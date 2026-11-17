import { execFileSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureCertificate, needsNewCertificate, tillNames } from '../server/secure.ts'

const hasOpenssl = (() => { try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); return true } catch { return false } })()
const dirs: string[] = []
const tempDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kennko-cert-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })
const DAY = 24 * 60 * 60 * 1000

describe('till names', () => {
  it('lists the ways a tablet can reach the till', () => {
    expect(tillNames(['192.168.1.20'], 'Shop-Mac.local')).toEqual(['localhost', '127.0.0.1', '192.168.1.20', 'shop-mac.local'])
    expect(tillNames(['10.0.0.5', '192.168.1.20'], 'shop-mac')).toEqual(['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.20', 'shop-mac.local'])
  })
  it('leaves out anything that is not on a local network', () => {
    expect(tillNames(['8.8.8.8', 'fe80::1'], 'till.example.com')).toEqual(['localhost', '127.0.0.1'])
    expect(tillNames([], 'localhost')).toEqual(['localhost', '127.0.0.1'])
  })
})

describe.skipIf(!hasOpenssl)('till certificate', () => {
  it('makes a certificate browsers accept for every till name', async () => {
    const names = tillNames(['192.168.1.20'], 'shop-mac')
    const made = ensureCertificate(tempDir(), names)
    if ('error' in made) throw new Error(made.error)
    expect(made.made).toBe(true)

    const cert = new X509Certificate(made.cert)
    const ca = new X509Certificate(fs.readFileSync(made.caFile))
    expect(ca.ca).toBe(true)
    expect(cert.ca).toBe(false)
    expect(cert.checkIssued(ca)).toBe(true)
    expect(cert.checkHost('shop-mac.local')).toBe('shop-mac.local')
    expect(cert.checkIP('192.168.1.20')).toBe('192.168.1.20')
    expect(cert.checkHost('kennko.example.com')).toBeUndefined()
    expect((new Date(cert.validTo).getTime() - Date.now()) / DAY).toBeLessThanOrEqual(398)
    expect(fs.statSync(path.join(path.dirname(made.caFile), 'ca.key')).mode & 0o077).toBe(0)

    // A real TLS handshake that trusts only this authority.
    const server = https.createServer({ key: made.key, cert: made.cert }, (_req, res) => res.end('ok'))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    const body = await new Promise<string>((resolve, reject) => {
      https.get({ host: '127.0.0.1', port, servername: 'localhost', ca: fs.readFileSync(made.caFile) }, (res) => {
        let text = ''
        res.on('data', (chunk) => { text += chunk }).on('end', () => resolve(text))
      }).on('error', reject)
    })
    server.close()
    expect(body).toBe('ok')
  })

  it('keeps the authority and the certificate when nothing changed', () => {
    const dir = tempDir()
    const names = tillNames(['192.168.1.20'], 'shop-mac')
    const first = ensureCertificate(dir, names)
    const second = ensureCertificate(dir, names)
    if ('error' in first || 'error' in second) throw new Error('could not make a certificate')
    expect(second.made).toBe(false)
    expect(second.cert).toBe(first.cert)
  })

  it('makes a new certificate under the same authority when the address changes', () => {
    const dir = tempDir()
    const first = ensureCertificate(dir, tillNames(['192.168.1.20'], 'shop-mac'))
    if ('error' in first) throw new Error(first.error)
    const ca = fs.readFileSync(first.caFile, 'utf8')
    const second = ensureCertificate(dir, tillNames(['192.168.1.77'], 'shop-mac'))
    if ('error' in second) throw new Error(second.error)
    expect(second.made).toBe(true)
    expect(fs.readFileSync(second.caFile, 'utf8')).toBe(ca)
    expect(new X509Certificate(second.cert).checkIP('192.168.1.77')).toBe('192.168.1.77')
  })

  it('renews in the last month and rejects a certificate from another authority', () => {
    const names = tillNames(['192.168.1.20'], 'shop-mac')
    const a = ensureCertificate(tempDir(), names)
    const b = ensureCertificate(tempDir(), names)
    if ('error' in a || 'error' in b) throw new Error('could not make a certificate')
    const caA = fs.readFileSync(a.caFile, 'utf8')
    expect(needsNewCertificate(a.cert, caA, names, Date.now())).toBe(false)
    expect(needsNewCertificate(a.cert, caA, names, Date.now() + 380 * DAY)).toBe(true)
    expect(needsNewCertificate(b.cert, caA, names, Date.now())).toBe(true)
    expect(needsNewCertificate('not a certificate', caA, names, Date.now())).toBe(true)
  })

  it('cannot sign for a name on the internet', () => {
    const dir = tempDir()
    const made = ensureCertificate(dir, ['localhost'])
    if ('error' in made) throw new Error(made.error)
    const f = (name: string) => path.join(dir, name)
    fs.writeFileSync(f('bad.ext'), 'subjectAltName=DNS:bank.example.com\n')
    execFileSync('openssl', ['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', f('bad.key'), '-out', f('bad.csr'), '-subj', '/CN=bank.example.com'], { stdio: 'ignore' })
    execFileSync('openssl', ['x509', '-req', '-in', f('bad.csr'), '-CA', f('ca.crt'), '-CAkey', f('ca.key'), '-CAcreateserial', '-out', f('bad.crt'), '-days', '30', '-extfile', f('bad.ext')], { stdio: 'ignore' })
    expect(() => execFileSync('openssl', ['verify', '-CAfile', f('ca.crt'), f('bad.crt')], { stdio: 'pipe' })).toThrow(/permitted subtree violation|name constraints/i)
    expect(execFileSync('openssl', ['verify', '-CAfile', f('ca.crt'), f('till.crt')], { stdio: 'pipe' }).toString()).toMatch(/OK/)
  })
})
