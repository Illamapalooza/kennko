import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { backupDay } from '../server/backup.ts'
import { createStore, type NewOrder } from '../till/store.ts'
import { openNodeSqlite } from '../server/node-sqlite.ts'
import { builtInMenu } from '../till/menu.ts'

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
    const store = createStore(path.join(dir, 'pos.db'), openNodeSqlite)
    store.startShift(50000, T, null)
    store.createOrder(menu, sale, T, null)

    const { file, copy } = backupDay((to) => store.snapshot(to), path.join(dir, 'backups'), '2026-11-17')
    expect(path.basename(file)).toBe('pos-2026-11-17.db')
    expect(copy).toBeNull()

    const restored = createStore(file, openNodeSqlite)
    expect(restored.ordersForDay('2026-11-17')).toHaveLength(1)
    expect(restored.ordersForDay('2026-11-17')[0].totalCentavos).toBe(10000)
    restored.close()
    store.close()
  })

  it('keeps no online orders (customer phone and address) in the backup or the second copy (Ruling P5-3)', () => {
    const dir = tempDir()
    const store = createStore(path.join(dir, 'pos.db'), openNodeSqlite)
    store.startShift(50000, T, null)
    store.createOrder(menu, sale, T, null)
    store.replaceOnlineOrders([{
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', businessDay: '2026-11-17', ticketNumber: 2, customerName: 'Jose Reyes',
      fulfilment: 'delivery', fulfilAt: '2026-11-17T02:30:00.000Z', customerNote: null, prepStatus: 'preparing',
      createdAt: '2026-11-17T01:55:00.000Z', updatedAt: '2026-11-17T01:56:00.000Z',
      lines: [{ name: 'Café Latte', size: 'M', quantity: 1, options: [], iceLevel: 'regular', iceServe: 'mixed', note: '' }],
      delivery: { address: '12 Montilla Blvd', barangay: 'Libertad', phone: '09171234567' },
    }])

    const { file, copy } = backupDay((to) => store.snapshot(to), path.join(dir, 'backups'), '2026-11-17', path.join(dir, 'usb'))
    for (const f of [file, copy!]) {
      expect(fs.readFileSync(f).includes('09171234567')).toBe(false)
      expect(fs.readFileSync(f).includes('Montilla')).toBe(false)
      const restored = createStore(f, openNodeSqlite)
      expect(restored.onlineOrders()).toEqual([])
      expect(restored.ordersForDay('2026-11-17')).toHaveLength(1)
      restored.close()
    }
    // The live till keeps its queue.
    expect(store.onlineOrders()).toHaveLength(1)
    store.close()
  })

  it('keeps no visiting cats and no check-in secret in the backup copy (Plan 8)', () => {
    const dir = tempDir()
    const store = createStore(path.join(dir, 'pos.db'), openNodeSqlite)
    const secret = 'q'.repeat(43)
    store.setCheckin({ secret, url: 'https://kennko.vercel.app/here' })
    store.kvSet('checkin_skew', '1200')
    store.replaceVisitors([{ key: 'v-1', name: 'Mochi', look: { coat: 'ginger' }, endsAt: new Date(T + 3_600_000).toISOString() }])

    const { file, copy } = backupDay((to) => store.snapshot(to), path.join(dir, 'backups'), '2026-11-17', path.join(dir, 'usb'))
    for (const f of [file, copy!]) {
      expect(fs.readFileSync(f).includes(secret)).toBe(false)
      expect(fs.readFileSync(f).includes('Mochi')).toBe(false)
      const restored = createStore(f, openNodeSqlite)
      expect(restored.checkinConfig()).toBeNull()
      expect(restored.kvGet('checkin_secret')).toBeNull()
      expect(restored.activeVisitors(T)).toEqual([])
      restored.close()
    }
    // The live till keeps both.
    expect(store.checkinConfig()?.secret).toBe(secret)
    expect(store.activeVisitors(T)).toHaveLength(1)
    store.close()
  })

  it('replaces the same day and picks up later sales', () => {
    const dir = tempDir()
    const store = createStore(path.join(dir, 'pos.db'), openNodeSqlite)
    const backups = path.join(dir, 'backups')
    store.startShift(50000, T, null)
    store.createOrder(menu, sale, T, null)
    backupDay((to) => store.snapshot(to), backups, '2026-11-17')
    store.createOrder(menu, sale, T + 60_000, null)
    const { file } = backupDay((to) => store.snapshot(to), backups, '2026-11-17')

    expect(fs.readdirSync(backups)).toEqual(['pos-2026-11-17.db'])
    const restored = createStore(file, openNodeSqlite)
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

  it('removes the half-written copy when the snapshot fails after writing it (no customer data left behind)', () => {
    const dir = tempDir()
    expect(() => backupDay((to) => { fs.writeFileSync(to, 'phone 09171234567'); throw new Error('scrub failed') }, dir, '2026-11-17'))
      .toThrow('scrub failed')
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('leaves the last good backup in place when the snapshot fails', () => {
    const dir = tempDir()
    backupDay((to) => fs.writeFileSync(to, 'good'), dir, '2026-11-17')
    expect(() => backupDay(() => { throw new Error('disk full') }, dir, '2026-11-17')).toThrow('disk full')
    expect(fs.readFileSync(path.join(dir, 'pos-2026-11-17.db'), 'utf8')).toBe('good')
  })
})
