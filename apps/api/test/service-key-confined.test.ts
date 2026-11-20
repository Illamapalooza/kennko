import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Ruling 12: the service-role key appears in the API only where it is parsed, wired and used. */
const ALLOWED = new Set(['config.ts', 'boot.ts', 'storage.ts', 'auth-admin.ts'])
const NAMES = /SUPABASE_SERVICE_ROLE_KEY|supabaseServiceRoleKey|serviceKey/

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  )
}

describe('the service key stays confined', () => {
  it('only config.ts, boot.ts, storage.ts and auth-admin.ts name it', () => {
    const files = walk(src)
    expect(files.length).toBeGreaterThan(20)
    const offenders = files.map((f) => relative(src, f)).filter((f) => !ALLOWED.has(f) && NAMES.test(readFileSync(join(src, f), 'utf8')))
    expect(offenders).toEqual([])
  })

  it('the allowed files are top-level files that exist (so a move cannot dodge the check)', () => {
    const top = new Set(readdirSync(src))
    for (const f of ALLOWED) expect(top.has(f), f).toBe(true)
  })
})
