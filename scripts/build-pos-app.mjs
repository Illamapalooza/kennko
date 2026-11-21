import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const release = args.includes('--release')
const selftest = args.includes('--selftest')
const apiUrl = (process.env.KENNKO_API_URL ?? '').trim()

if (release && !apiUrl.startsWith('https://')) {
  console.error('KENNKO_API_URL must be the production https address')
  process.exit(1)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const posDir = path.join(root, 'apps/pos')
const androidDir = path.join(posDir, 'android')

const env = {
  ...process.env,
  VITE_TILL: 'app',
  VITE_KENNKO_API_URL: apiUrl,
  ...(selftest ? { VITE_SELFTEST: '1' } : {}),
}

const jbr = '/Applications/Android Studio.app/Contents/jbr/Contents/Home'
if (fs.existsSync(jbr) && (!env.JAVA_HOME || !env.JAVA_HOME.includes('jbr'))) {
  env.JAVA_HOME = jbr
}

function run(cmd, cmdArgs, cwd) {
  const res = spawnSync(cmd, cmdArgs, { cwd, env, stdio: 'inherit' })
  if (res.status !== 0) process.exit(res.status ?? 1)
}

run('npx', ['vite', 'build', '--mode', 'app'], posDir)
run('npx', ['cap', 'sync', 'android'], posDir)
run('./gradlew', [release ? 'assembleRelease' : 'assembleDebug'], androidDir)
