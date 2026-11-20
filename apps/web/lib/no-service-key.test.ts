import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The website runs without the Supabase service key (Ruling 16): every privileged read or write goes
 * through the API. Only the local developer scripts under `scripts/` may use it, so `scripts/` is not
 * walked. Anything else naming the key or a service-role client fails here. Tests are skipped: they
 * never ship, and some name these words to assert their absence.
 */
const WEB = path.resolve(__dirname, '..')
const ROOTS = ['app', 'components', 'lib']
const FILES = ['proxy.ts']
const FORBIDDEN = ['SUPABASE_SERVICE_ROLE_KEY', 'supabase/admin', 'getAdminClient']

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) && !/\.test\.[jt]sx?$/.test(name)) out.push(full)
  }
  return out
}

describe('the website holds no service key', () => {
  const files = [...ROOTS.flatMap((r) => walk(path.join(WEB, r), [])), ...FILES.map((f) => path.join(WEB, f))]

  it('walks real files', () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files.some((f) => f.endsWith(path.join('app', 'admin', 'orders', 'actions.ts')))).toBe(true)
    expect(files.some((f) => f.endsWith(path.join('lib', 'api', 'client.ts')))).toBe(true)
    expect(files.some((f) => f.endsWith('proxy.ts'))).toBe(true)
  })

  it('no file in app/, components/, lib/ or proxy.ts names the key or a service-role client', () => {
    const offenders = files.flatMap((f) => {
      const src = readFileSync(f, 'utf8')
      return FORBIDDEN.filter((needle) => src.includes(needle)).map((needle) => `${path.relative(WEB, f)}: ${needle}`)
    })
    expect(offenders).toEqual([])
  })

  it('lib/supabase/admin.ts is gone', () => {
    expect(existsSync(path.join(WEB, 'lib', 'supabase', 'admin.ts'))).toBe(false)
  })
})
