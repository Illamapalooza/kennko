import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const POS_APK = path.join(ROOT, 'apps/pos/android/app/build/outputs/apk/release/app-release.apk')
const WALL_APK = path.join(ROOT, 'apps/wall-app/android/app/build/outputs/apk/release/app-release.apk')

const args = process.argv.slice(2)
const fresh = args.includes('--fresh')

function argValue(flag) {
  const idx = args.indexOf(flag)
  return idx >= 0 ? args[idx + 1] : undefined
}

function adb(serial, cmdArgs, ignoreError = false) {
  const full = serial ? ['-s', serial, ...cmdArgs] : cmdArgs
  try {
    return execFileSync('adb', full, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (err) {
    if (ignoreError) return ''
    throw err
  }
}

function detectDevices() {
  const out = adb(null, ['devices', '-l'])
  const devices = []
  for (const line of out.split(/\r?\n/)) {
    if (!line || line.startsWith('List of devices')) continue
    const [serial, state] = line.trim().split(/\s+/)
    if (state === 'device') devices.push({ serial, line })
  }
  return devices
}

function installApp(label, serial, pkg, apkPath) {
  if (!fs.existsSync(apkPath)) {
    throw new Error(`Missing ${label} release APK at ${apkPath}. Build it first with --release.`)
  }
  console.log(`\n==> Installing ${label} (${pkg}) to ${serial}...`)
  if (fresh) {
    console.log(`    Uninstalling existing ${pkg} (--fresh)...`)
    adb(serial, ['uninstall', pkg], true)
  }
  execFileSync('adb', ['-s', serial, 'install', '-r', apkPath], { stdio: 'inherit' })
  adb(serial, ['shell', 'am', 'force-stop', pkg], true)
  execFileSync('adb', ['-s', serial, 'shell', 'am', 'start', '-n', `${pkg}/.MainActivity`], { stdio: 'inherit' })
  console.log(`    Done: ${label} launched on ${serial}.`)
}

const devices = detectDevices()
const tablet = argValue('--tablet') ?? devices.find((d) => d.line.includes('SM_X210'))?.serial
const projector = argValue('--projector') ?? devices.find((d) => d.line.includes('TV_Stick') || d.line.startsWith('192.168.1.21:'))?.serial

if (!tablet && !projector) {
  console.error('No tablet (SM_X210) or projector (TV_Stick) found via `adb devices -l`.')
  console.error('Connect devices over wireless ADB first, or pass --tablet <serial> / --projector <serial>.')
  process.exit(1)
}

if (tablet) installApp('Kennko POS', tablet, 'coffee.kennko.pos', POS_APK)
else console.log('\nSkipping Kennko POS: tablet not connected (pass --tablet <serial> to specify).')

if (projector) installApp('Kennko Wall', projector, 'coffee.kennko.wall', WALL_APK)
else console.log('\nSkipping Kennko Wall: projector not connected (pass --projector <serial> to specify).')
