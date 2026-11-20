import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { backupDay } from '../server/backup.ts'
import { createStore, type NewOrder } from '../server/store.ts'
import { builtInMenu } from '../server/menu.ts'

const menu = builtInMenu(0)
const latte = menu.categories[0].items.find((i) => i.name === 'Café Latte')!
const T = Date.UTC(2026, 10, 17, 2, 0)
const sale: NewOrder = {
  lines: [{ menuItemId: latte.id, size: 'M', modifierIds: [], quantity: 1, iceLevel: 'regular', iceServe: 'mixed', note: '' }],
  type: 'takeout',
  payment: { method: 'cash', tenderedCentavos: 10000 },
}

const dirs: string[] = []
const tempDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kennko-backup-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

describe('daily backup', () => {
  it('writes a copy that opens as a till with the same sales', () => {
    const dir = tempDir()
    const store = createStore(path.join(dir, 'pos.db'))
    store.startShift(50000, T, null)
    store.createOrder(menu, sale, T, null)

    const { file, copy } = backupDay((to) => store.snapshot(to), path.join(dir, 'backups'), '2026-11-17')
    expect(path.basename(file)).toBe('pos-2026-11-17.db')
    expect(copy).toBeNull()

    const restored = createStore(file)
    expect(restored.ordersForDay('2026-11-17')).toHaveLength(1)
    expect(restored.ordersForDay('2026-11-17')[0].totalCentavos).toBe(10000)
    restored.close()
    store.close()
  })

  it('replaces the same day and picks up later sales', () => {
    const dir = tempDir()
    const store = createStore(path.join(dir, 'pos.db'))
    const backups = path.join(dir, 'backups')
    store.startShift(50000, T, null)
    store.createOrder(menu, sale, T, null)
    backupDay((to) => store.snapshot(to), backups, '2026-11-17')
    store.createOrder(menu, sale, T + 60_000, null)
    const { file } = backupDay((to) => store.snapshot(to), backups, '2026-11-17')

    expect(fs.readdirSync(backups)).toEqual(['pos-2026-11-17.db'])
    const restored = createStore(file)
    expect(restored.ordersForDay('2026-11-17')).toHaveLength(2)
    restored.close()
    store.close()
  })

  it('keeps only the newest days and leaves other files alone', () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'keep me')
    for (const day of ['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16']) {
      backupDay((to) => fs.writeFileSync(to, day), dir, day, '', 3)
    }
    expect(fs.readdirSync(dir).sort()).toEqual(['notes.txt', 'pos-2026-11-14.db', 'pos-2026-11-15.db', 'pos-2026-11-16.db'])
  })

  it('sends a second copy when a folder is set', () => {
    const dir = tempDir()
    const second = path.join(tempDir(), 'usb')
    const { copy, copyError } = backupDay((to) => fs.writeFileSync(to, 'sales'), dir, '2026-11-17', second)
    expect(copyError).toBeNull()
    expect(fs.readFileSync(copy!, 'utf8')).toBe('sales')
  })

  it('still saves locally when the second folder cannot be written', () => {
    const dir = tempDir()
    const blocker = path.join(tempDir(), 'not-a-folder')
    fs.writeFileSync(blocker, '')
    const { file, copy, copyError } = backupDay((to) => fs.writeFileSync(to, 'sales'), dir, '2026-11-17', blocker)
    expect(fs.existsSync(file)).toBe(true)
    expect(copy).toBeNull()
    expect(copyError).toBeTruthy()
  })

  it('leaves the last good backup in place when the snapshot fails', () => {
    const dir = tempDir()
    backupDay((to) => fs.writeFileSync(to, 'good'), dir, '2026-11-17')
    expect(() => backupDay(() => { throw new Error('disk full') }, dir, '2026-11-17')).toThrow('disk full')
    expect(fs.readFileSync(path.join(dir, 'pos-2026-11-17.db'), 'utf8')).toBe('good')
  })
})
