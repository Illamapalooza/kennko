#!/usr/bin/env node
// Starts the Kennko apps together in one terminal, for development.
//
//   npm run all            website (landing + online ordering + admin) and the till
//   npm run all -- --wall  the same, plus the projector wall following the till
//
// Each app's output is prefixed with its name. Ctrl+C stops all of them, and if one app
// crashes the others are stopped too, so nothing is left running in the background.
// Plain Node with no dependencies, so it works on the Mac and on the shop's Windows tablet.
import { spawn } from 'node:child_process'

const withWall = process.argv.includes('--wall')

const apps = [
  { name: 'web ', script: 'dev', url: 'http://localhost:3000', what: 'landing, ordering (/order), admin (/admin)' },
  { name: 'pos ', script: 'pos', url: 'http://localhost:4466', what: 'the till' },
  ...(withWall ? [{ name: 'wall', script: 'wall:pos', url: 'http://localhost:4455', what: 'projector wall, following the till' }] : []),
]

const colours = ['\x1b[34m', '\x1b[33m', '\x1b[35m']
const reset = '\x1b[0m'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const children = []
let stopping = false

function prefix(stream, label) {
  let buffered = ''
  return (chunk) => {
    buffered += chunk.toString()
    const lines = buffered.split(/\r?\n/)
    buffered = lines.pop()
    for (const line of lines) stream.write(`${label} ${line}\n`)
  }
}

function stopAll(code) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (child.exitCode !== null) continue
    if (process.platform === 'win32') {
      // npm.cmd runs the app in a child process; kill the whole tree.
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
    } else {
      try { process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ }
    }
  }
  setTimeout(() => process.exit(code), 500)
}

apps.forEach((app, i) => {
  const label = `${colours[i % colours.length]}[${app.name}]${reset}`
  const child = spawn(npm, ['run', app.script], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, FORCE_COLOR: '1' },
    // Own process group on Mac/Linux, so stopping it also stops what npm started.
    detached: process.platform !== 'win32',
    shell: process.platform === 'win32',
  })
  child.stdout.on('data', prefix(process.stdout, label))
  child.stderr.on('data', prefix(process.stderr, label))
  child.on('exit', (code) => {
    if (stopping) return
    console.error(`${label} stopped (exit ${code}). Stopping the others.`)
    stopAll(code ?? 1)
  })
  children.push(child)
})

console.log('\n  KENNKO — starting ' + apps.length + ' apps\n')
for (const app of apps) console.log(`  ${app.name}  ${app.url}  ${app.what}`)
console.log('\n  Ctrl+C stops everything.\n')

process.on('SIGINT', () => stopAll(0))
process.on('SIGTERM', () => stopAll(0))
