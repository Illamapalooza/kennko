import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const UPDATES_PATH = path.join(ROOT, 'apps/web/public/apps/updates.json')
const APP_PKG = {
  pos: path.join(ROOT, 'apps/pos/package.json'),
  wall: path.join(ROOT, 'apps/wall-app/package.json'),
}

export function versionToCode(version) {
  const parts = String(version).split('.').map((n) => Number.parseInt(n, 10))
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n) || n < 0)) {
    throw new Error(`Invalid semver version: ${version}`)
  }
  return parts[0] * 10000 + parts[1] * 100 + parts[2]
}

export function nextUpdates(current, app, entry) {
  if (app !== 'pos' && app !== 'wall') {
    throw new Error(`Unknown app "${app}". Expected "pos" or "wall".`)
  }
  if (!entry.url || !entry.url.startsWith('https://')) {
    throw new Error(`APK url must use https:// (got "${entry.url}")`)
  }
  const prev = current?.[app]?.versionCode ?? 0
  if (entry.versionCode <= prev) {
    throw new Error(`versionCode ${entry.versionCode} is not newer than ${prev} in updates.json`)
  }
  return {
    ...current,
    [app]: {
      versionCode: entry.versionCode,
      versionName: entry.versionName,
      url: entry.url,
      notes: entry.notes ?? '',
    },
  }
}

function parseArgs(argv) {
  const [app, url, ...rest] = argv
  let notes = ''
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--notes' && rest[i + 1] !== undefined) {
      notes = rest[i + 1]
      i += 1
    }
  }
  return { app, url, notes }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { app, url, notes } = parseArgs(process.argv.slice(2))
  if (!app || !url) {
    console.error('Usage: node scripts/release-apk.mjs <pos|wall> <https-apk-url> [--notes "..."]')
    process.exit(1)
  }
  const pkgPath = APP_PKG[app]
  if (!pkgPath) {
    console.error(`Unknown app "${app}". Expected "pos" or "wall".`)
    process.exit(1)
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const versionName = String(pkg.version)
  const versionCode = versionToCode(versionName)
  const current = JSON.parse(fs.readFileSync(UPDATES_PATH, 'utf8'))
  const next = nextUpdates(current, app, { versionCode, versionName, url, notes })
  fs.writeFileSync(UPDATES_PATH, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`Updated ${UPDATES_PATH}: ${app} -> ${versionName} (${versionCode})`)
}
