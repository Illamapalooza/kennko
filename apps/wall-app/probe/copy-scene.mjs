import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')
const wallPub = path.join(repoRoot, 'wall/public')
const out = path.join(here, '../www-probe/scene')

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

for (const f of fs.readdirSync(path.join(wallPub, 'scene')).filter((x) => x.endsWith('.mjs'))) {
  fs.copyFileSync(path.join(wallPub, 'scene', f), path.join(out, f))
}
fs.copyFileSync(path.join(wallPub, 'wall.css'), path.join(out, 'wall.css'))
fs.cpSync(path.join(wallPub, 'brand'), path.join(out, 'brand'), { recursive: true })
console.log('Copied wall scene assets to www-probe/scene')
