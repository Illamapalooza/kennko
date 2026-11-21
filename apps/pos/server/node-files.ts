import fs from 'node:fs'
import path from 'node:path'
import type { TillFiles } from '../till/files.ts'

export function nodeFiles(dir: string): TillFiles {
  return {
    read(name: string): string | null {
      try {
        return fs.readFileSync(path.join(dir, name), 'utf8')
      } catch (err: any) {
        if (err.code === 'ENOENT') return null
        throw err
      }
    },
    write(name: string, text: string, opts?: { secret?: boolean }): void {
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, name)
      const tmp = `${file}.tmp`
      const mode = opts?.secret ? 0o600 : 0o644
      fs.writeFileSync(tmp, text, { mode })
      if (opts?.secret) fs.chmodSync(tmp, 0o600)
      fs.renameSync(tmp, file)
    },
    remove(name: string): void {
      fs.rmSync(path.join(dir, name), { force: true })
    },
  }
}
