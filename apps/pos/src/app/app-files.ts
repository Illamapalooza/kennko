import type { TillFiles } from '../../till/files.ts'
import type { Store } from '../../till/store.ts'

const PREFIX = 'file:'

export function appFiles(store: Store): TillFiles {
  return {
    read(name: string): string | null {
      return store.kvGet(`${PREFIX}${name}`)
    },
    write(name: string, text: string): void {
      store.kvSet(`${PREFIX}${name}`, text)
    },
    remove(name: string): void {
      store.db.prepare('delete from kv where key = ?').run(`${PREFIX}${name}`)
    },
  }
}
