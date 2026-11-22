import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const release = args.includes('--release')
const here = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(here, '..')
const androidDir = path.join(appDir, 'android')

const env = { ...process.env }
const jbr = '/Applications/Android Studio.app/Contents/jbr/Contents/Home'
if (fs.existsSync(jbr) && (!env.JAVA_HOME || !env.JAVA_HOME.includes('jbr'))) {
  env.JAVA_HOME = jbr
}

function run(cmd, cmdArgs, cwd) {
  const res = spawnSync(cmd, cmdArgs, { cwd, env, stdio: 'inherit' })
  if (res.status !== 0) process.exit(res.status ?? 1)
}

run('node', ['scripts/copy-wall.mjs'], appDir)
run('npx', ['cap', 'sync', 'android'], appDir)
run('./gradlew', [release ? 'assembleRelease' : 'assembleDebug'], androidDir)
