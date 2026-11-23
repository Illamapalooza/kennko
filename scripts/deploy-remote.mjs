#!/usr/bin/env node
// Remote OTA release helper for Kennko Android apps (POS & Wall).
// Usage: node scripts/deploy-remote.mjs <wall|pos|both> [--notes "..."] [--no-bump] [--skip-tests]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG_PATHS = {
  pos: path.join(ROOT, 'apps/pos/package.json'),
  wall: path.join(ROOT, 'apps/wall-app/package.json'),
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts })
}

function bumpPatch(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const parts = String(pkg.version).split('.').map((n) => Number.parseInt(n, 10))
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`Invalid semver "${pkg.version}" in ${pkgPath}`)
  }
  const next = `${parts[0]}.${parts[1]}.${parts[2] + 1}`
  pkg.version = next
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  return next
}

const args = process.argv.slice(2)
const target = args[0]
if (!target || !['pos', 'wall', 'both'].includes(target)) {
  console.error('Usage: node scripts/deploy-remote.mjs <wall|pos|both> [--notes "..."] [--no-bump] [--skip-tests]')
  process.exit(1)
}

let notes = ''
let noBump = false
let skipTests = false
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--notes' && args[i + 1] !== undefined) {
    notes = args[++i]
  } else if (args[i] === '--no-bump') {
    noBump = true
  } else if (args[i] === '--skip-tests') {
    skipTests = true
  }
}

if (!skipTests) {
  run('npm', ['test'])
  run('npm', ['run', 'typecheck'])
}

const bumped = []
if (!noBump) {
  if (target === 'pos' || target === 'both') bumped.push(`pos ${bumpPatch(PKG_PATHS.pos)}`)
  if (target === 'wall' || target === 'both') bumped.push(`wall ${bumpPatch(PKG_PATHS.wall)}`)
  if (bumped.length) {
    const files = Object.values(PKG_PATHS).map((p) => path.relative(ROOT, p))
    run('git', ['add', ...files])
    const status = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: ROOT, encoding: 'utf8' }).trim()
    if (status) {
      run('git', ['commit', '-m', `chore(release): bump ${bumped.join(', ')}`])
    }
  }
}

run('git', ['push', 'origin', 'main'])
run('gh', ['variable', 'set', 'ENABLE_ANDROID_RELEASE', '--body', 'true'])
run('gh', ['workflow', 'run', 'android-release.yml', '-f', `app=${target}`, '-f', `notes=${notes}`])
console.log('\nTriggered Android Release (OTA) workflow. Check progress with: gh run list --workflow=android-release.yml --limit 3')
