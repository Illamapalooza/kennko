import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../server/config.ts'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

describe('config discounts', () => {
  it('drops discount presets that are not whole numbers, and says so', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kennko-config-')); dirs.push(dir)
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ discounts: [
      { label: 'Odd', kind: 'percent', value: 12.5 },
      { label: 'Promo 10%', kind: 'percent', value: 10 },
      { label: 'Half peso', kind: 'amount', value: 50.5 },
      { label: 'Less 50', kind: 'amount', value: 5000 },
    ] }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(loadConfig(dir).discounts.map((d) => d.label)).toEqual(['Promo 10%', 'Less 50'])
      expect(warn).toHaveBeenCalledTimes(2)
      expect(String(warn.mock.calls[0][0])).toMatch(/Odd/)
    } finally {
      warn.mockRestore()
    }
  })
})
