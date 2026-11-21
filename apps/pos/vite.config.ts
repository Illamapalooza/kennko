import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const walk = (dir: string, base = ''): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(path.join(dir, entry.name), `${base}${entry.name}/`) : entry.name.startsWith('.') ? [] : [`${base}${entry.name}`])

/**
 * Writes sw.js with the exact list of built files, so an installed till opens from its own copy
 * even when the till computer is unreachable. The cache name changes whenever any file does.
 */
function offlineCopy(): Plugin {
  return {
    name: 'kennko-offline-copy',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((name) => !name.endsWith('.map') && name !== 'index.html')
      const files = ['/', ...[...built, ...walk(path.resolve(import.meta.dirname, 'public'))].sort().map((name) => `/${name}`)]
      const hash = createHash('sha256')
      for (const [name, chunk] of Object.entries(bundle)) hash.update(name).update(chunk.type === 'chunk' ? chunk.code : String(chunk.source.length))
      for (const name of walk(path.resolve(import.meta.dirname, 'public'))) hash.update(name).update(fs.readFileSync(path.resolve(import.meta.dirname, 'public', name)))
      const template = fs.readFileSync(path.resolve(import.meta.dirname, 'src/sw.template.js'), 'utf8')
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace("'__CACHE__'", JSON.stringify(`kennko-pos-${hash.digest('hex').slice(0, 12)}`)).replace("'__FILES__'", JSON.stringify(files)),
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: mode === 'app' ? [react()] : [react(), offlineCopy()],
  build: { outDir: mode === 'app' ? 'dist-app' : 'dist', emptyOutDir: true },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
}))
