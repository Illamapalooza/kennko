import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const tillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../till')

describe('till core portability', () => {
  it('imports no node:* modules and references no process.', () => {
    const files = fs.readdirSync(tillDir).filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const src = fs.readFileSync(path.join(tillDir, file), 'utf8')
      expect(src, `${file} imports node:*`).not.toMatch(/from\s+['"]node:/)
      expect(src, `${file} references process.`).not.toMatch(/\bprocess\./)
    }
  })
})
