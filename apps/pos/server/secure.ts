import { execFileSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Browsers only install an app, and only keep an offline copy, from an https address. A till on the
 * shop wifi has no public name to get a normal certificate for, so the till makes its own: a small
 * certificate authority that lives on this computer, and a certificate for the till signed by it.
 * Each tablet is told once to trust that authority (see /setup).
 *
 * The authority is limited to names on a local network (private addresses, localhost and .local),
 * so even with its key nobody can use it to pose as a website on the internet.
 */

const DAY = 24 * 60 * 60 * 1000
const CA_DAYS = 3650
const CERT_DAYS = 397 // the longest a browser accepts
const RENEW_BEFORE = 30 * DAY
const PERMITTED = [
  'permitted;DNS:localhost', 'permitted;DNS:local',
  'permitted;IP:10.0.0.0/255.0.0.0', 'permitted;IP:172.16.0.0/255.240.0.0', 'permitted;IP:192.168.0.0/255.255.0.0',
  'permitted;IP:169.254.0.0/255.255.0.0', 'permitted;IP:127.0.0.0/255.0.0.0',
].join(',')

export type Certificate = { key: string; cert: string; caFile: string; names: string[]; made: boolean }

const isIp = (name: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(name)
const isPrivate = (ip: string) => {
  const [a, b] = ip.split('.').map(Number)
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
}

/** Every name a tablet might type to reach this till, limited to what the authority may sign for. */
export function tillNames(addresses: string[], hostname: string): string[] {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  const bonjour = !host || host === 'localhost' ? '' : host.endsWith('.local') ? host : host.includes('.') ? '' : `${host}.local`
  const names = ['localhost', '127.0.0.1', ...addresses.filter((a) => isIp(a) && isPrivate(a)).sort()]
  if (/^[a-z0-9-]+\.local$/.test(bonjour)) names.push(bonjour)
  return [...new Set(names)]
}

const certNames = (cert: X509Certificate) =>
  (cert.subjectAltName ?? '').split(',').map((part) => part.trim().replace(/^(DNS|IP Address):/, '')).filter(Boolean)

/** True when the saved certificate is missing a name, was not signed by this authority, or is close to running out. */
export function needsNewCertificate(certPem: string, caPem: string, names: string[], now: number): boolean {
  try {
    const cert = new X509Certificate(certPem)
    const ca = new X509Certificate(caPem)
    if (!cert.checkIssued(ca) || !cert.verify(ca.publicKey)) return true
    if (new Date(cert.validTo).getTime() - now < RENEW_BEFORE) return true
    const have = new Set(certNames(cert))
    return names.some((name) => !have.has(name))
  } catch {
    return true
  }
}

// Windows has no openssl of its own, but Git for Windows (needed to fetch the code) brings one.
const OPENSSL = process.platform === 'win32'
  ? ['openssl', ...[process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]
      .filter((dir): dir is string => Boolean(dir))
      .flatMap((dir) => [path.join(dir, 'Git', 'mingw64', 'bin', 'openssl.exe'), path.join(dir, 'Git', 'usr', 'bin', 'openssl.exe')])]
  : ['openssl']
let opensslBin: string | null | undefined
function findOpenssl(): string | null {
  if (opensslBin !== undefined) return opensslBin
  for (const candidate of OPENSSL) {
    try { execFileSync(candidate, ['version'], { stdio: 'ignore' }); return (opensslBin = candidate) } catch { /* try the next one */ }
  }
  return (opensslBin = null)
}
const openssl = (args: string[]) => {
  const bin = findOpenssl()
  if (!bin) throw Object.assign(new Error('openssl not found'), { code: 'ENOENT' })
  return execFileSync(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
}
const read = (file: string) => { try { return fs.readFileSync(file, 'utf8') } catch { return '' } }

/**
 * Returns the till's certificate, making or renewing it when needed. The authority is made once and
 * then kept, so tablets that already trust it keep working when the till's address changes.
 * Returns null, with the reason, when it cannot be made (openssl missing).
 */
export function ensureCertificate(dir: string, names: string[], now = Date.now()): Certificate | { error: string } {
  fs.mkdirSync(dir, { recursive: true })
  const file = (name: string) => path.join(dir, name)
  try {
    let caPem = read(file('ca.crt'))
    const caUsable = () => {
      try { return Boolean(read(file('ca.key'))) && new Date(new X509Certificate(caPem).validTo).getTime() - now > RENEW_BEFORE } catch { return false }
    }
    if (!caUsable()) {
      openssl(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-sha256',
        '-keyout', file('ca.key'), '-out', file('ca.crt'), '-days', String(CA_DAYS),
        '-subj', '/O=Kennko Coffee/CN=Kennko POS (this shop only)',
        '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
        '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
        '-addext', `nameConstraints=critical,${PERMITTED}`])
      fs.chmodSync(file('ca.key'), 0o600)
      caPem = read(file('ca.crt'))
    }

    let made = false
    if (!read(file('till.key')) || needsNewCertificate(read(file('till.crt')), caPem, names, now)) {
      const san = names.map((name) => `${isIp(name) ? 'IP' : 'DNS'}:${name}`).join(',')
      fs.writeFileSync(file('till.ext'), [
        'basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature', 'extendedKeyUsage=serverAuth', `subjectAltName=${san}`, '',
      ].join('\n'))
      openssl(['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-sha256',
        '-keyout', file('till.key'), '-out', file('till.csr'), '-subj', '/O=Kennko Coffee/CN=Kennko POS'])
      fs.chmodSync(file('till.key'), 0o600)
      openssl(['x509', '-req', '-in', file('till.csr'), '-CA', file('ca.crt'), '-CAkey', file('ca.key'), '-CAcreateserial',
        '-out', file('till.crt'), '-days', String(CERT_DAYS), '-sha256', '-extfile', file('till.ext')])
      fs.rmSync(file('till.csr'), { force: true })
      fs.rmSync(file('till.ext'), { force: true })
      made = true
    }
    return { key: read(file('till.key')), cert: read(file('till.crt')), caFile: file('ca.crt'), names, made }
  } catch (err: any) {
    return { error: err.code === 'ENOENT' ? 'openssl is not installed on this computer (on Windows, installing Git for Windows provides it)' : String(err.stderr || err.message).trim().split('\n').pop() ?? 'unknown error' }
  }
}
