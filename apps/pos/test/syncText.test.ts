import { describe, expect, it } from 'vitest'
import type { Menu } from '@kennko/core'
import type { SyncStatus } from '../src/api.ts'
import { clockWarning, menuLine, offlineBadge, syncProblem } from '../src/syncText.ts'

const NOW = Date.UTC(2026, 10, 21, 2, 0)
const status = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  paired: true, revoked: false, offline: false, pendingSales: 0, pendingEvents: 0,
  lastSyncAt: null, clockSkewMs: null, problem: null, menuVersion: null, importing: 0, ...over,
})
const menu = (over: Partial<Menu> = {}): Menu => ({ categories: [], modifierGroups: [], source: 'built-in', updatedAt: 0, ...over })

describe('offlineBadge', () => {
  it('counts sales, singular and plural', () => {
    expect(offlineBadge(status({ offline: true, pendingSales: 12, pendingEvents: 30 }))).toBe('Offline: 12 sales waiting to send')
    expect(offlineBadge(status({ offline: true, pendingSales: 1, pendingEvents: 4 }))).toBe('Offline: 1 sale waiting to send')
  })
  it('says changes when only other events wait, and when nothing waits', () => {
    expect(offlineBadge(status({ offline: true, pendingSales: 0, pendingEvents: 3 }))).toBe('Offline: changes waiting to send')
    expect(offlineBadge(status({ offline: true }))).toBe('Offline: changes waiting to send')
  })
  it('is null when online, unpaired or revoked', () => {
    expect(offlineBadge(status({ pendingSales: 5 }))).toBeNull()
    expect(offlineBadge(status({ paired: false, offline: true, pendingSales: 5 }))).toBeNull()
    expect(offlineBadge(status({ revoked: true, offline: true, pendingSales: 5 }))).toBeNull()
  })
})

describe('syncProblem', () => {
  it('shows a refused request that is not offline', () => {
    expect(syncProblem(status({ problem: 'The website said no.' }))).toBe('Sync problem: The website said no.')
  })
  it('is null when offline, no problem, unpaired or revoked', () => {
    expect(syncProblem(status({ offline: true, problem: 'Could not reach the website.' }))).toBeNull()
    expect(syncProblem(status())).toBeNull()
    expect(syncProblem(status({ paired: false, problem: 'x' }))).toBeNull()
    expect(syncProblem(status({ revoked: true, problem: 'x' }))).toBeNull()
  })
})

describe('clockWarning', () => {
  it('says behind when the website is ahead of the till', () => {
    expect(clockWarning(status({ clockSkewMs: 7 * 60_000 }))).toBe(
      "This computer's clock is 7 minutes behind. Sales still work; fix the time in Windows settings so reports line up.")
  })
  it('says ahead when the till is ahead', () => {
    expect(clockWarning(status({ clockSkewMs: -7 * 60_000 }))).toBe(
      "This computer's clock is 7 minutes ahead. Sales still work; fix the time in Windows settings so reports line up.")
  })
  it('is null at 4 minutes, exactly 5 minutes, or unknown', () => {
    expect(clockWarning(status({ clockSkewMs: 4 * 60_000 }))).toBeNull()
    expect(clockWarning(status({ clockSkewMs: 300_000 }))).toBeNull()
    expect(clockWarning(status({ clockSkewMs: null }))).toBeNull()
  })
})

describe('menuLine', () => {
  it('names the version and when it was checked', () => {
    const m = menu({ source: 'website', version: 12 })
    expect(menuLine(status({ lastSyncAt: NOW - 2 * 60_000 }), m, NOW)).toBe('Prices from Kennko, version 12, checked 2 min ago.')
    expect(menuLine(status({ lastSyncAt: NOW - 10_000 }), m, NOW)).toBe('Prices from Kennko, version 12, checked just now.')
    expect(menuLine(status({ lastSyncAt: NOW - 3 * 3_600_000 }), m, NOW)).toBe('Prices from Kennko, version 12, checked 3 h ago.')
  })
  it('uses the menu version, not the stale status one, and drops "checked" when never checked', () => {
    expect(menuLine(status({ paired: false, menuVersion: 3 }), menu({ source: 'website', version: 12 }), NOW)).toBe('Prices from Kennko, version 12.')
  })
  it('says the menu came with the till', () => {
    expect(menuLine(status(), menu(), NOW)).toBe('Using the menu that came with the till.')
  })
  it('shows the import while rows are still being copied', () => {
    expect(menuLine(status({ importing: 140 }), menu({ source: 'website', version: 12 }), NOW)).toBe('Copying sales history to Kennko: 140 left.')
  })
})
