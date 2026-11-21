import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { groupsFor, priceLine, type MenuSnapshot } from '@kennko/core'
import { builtInMenu, fetchApiMenu, loadSnapshot, splitSoldOut, tillDiscounts, tillMenu } from '../till/menu.ts'
import { nodeFiles } from '../server/node-files.ts'

const snapshot: MenuSnapshot = {
  version: 3,
  publishedAt: '2026-11-20T00:00:00.000Z',
  categories: [
    {
      id: 'c-drinks', name: 'Drinks', kind: 'drink',
      items: [{
        id: 'i-latte', name: 'Latte', description: null, imagePath: null, isBestseller: true, isAvailable: true, optionGroupIds: [],
        variants: [
          { id: 'v1', code: 'M', label: 'Medium', priceCentavos: 10000, temperature: 'iced', isAvailable: true },
          { id: 'v2', code: 'L', label: 'Large', priceCentavos: 11500, temperature: 'iced', isAvailable: false },
        ],
      }],
    },
    {
      id: 'c-food', name: 'Food', kind: 'food',
      items: [{
        id: 'i-cake', name: 'Cake', description: null, imagePath: null, isBestseller: false, isAvailable: true, optionGroupIds: [],
        variants: [{ id: 'v3', code: 'REG', label: 'Slice', priceCentavos: 9000, temperature: 'none', isAvailable: true }],
      }],
    },
  ],
  optionGroups: [],
  discountPresets: [],
}

const reply = (status: number, body: unknown) => vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))

afterEach(() => vi.unstubAllGlobals())

describe('splitSoldOut (manual pull on an unpaired till)', () => {
  it('saves every item, variant and option available and returns the unavailable ids for sold_out', () => {
    const withOptions: MenuSnapshot = {
      ...snapshot,
      categories: [
        { ...snapshot.categories[0]!, items: [{ ...snapshot.categories[0]!.items[0]!, optionGroupIds: ['g-milk'] }] },
        { ...snapshot.categories[1]!, items: [{ ...snapshot.categories[1]!.items[0]!, isAvailable: false }] },
      ],
      optionGroups: [{
        id: 'g-milk', name: 'Milk', minSelect: 0, maxSelect: 1,
        options: [{ id: 'o-oat', name: 'Oat', priceCentavos: 2000, isAvailable: false }, { id: 'o-soy', name: 'Soy', priceCentavos: 2000, isAvailable: true }],
      }],
    }
    const { snapshot: clean, soldOut } = splitSoldOut(withOptions)
    expect(soldOut.sort()).toEqual(['i-cake', 'o-oat', 'v2'])
    const flags = [
      ...clean.categories.flatMap((c) => c.items.flatMap((i) => [i.isAvailable, ...i.variants.map((v) => v.isAvailable)])),
      ...clean.optionGroups.flatMap((g) => g.options.map((o) => o.isAvailable)),
    ]
    expect(flags.every(Boolean)).toBe(true)
    expect(clean.version).toBe(withOptions.version)
    // Not changed in place.
    expect(withOptions.optionGroups[0]!.options[0]!.isAvailable).toBe(false)
    // The clean snapshot carries no sold-out marks of its own, so staff can put an item back from the till.
    const sold = new Set(soldOut)
    expect(tillMenu(clean, builtInMenu(0), sold, 0).categories.flatMap((c) => c.items).find((i) => i.id === 'i-latte')!.isAvailable).toBe(true)
    expect(splitSoldOut(clean).soldOut).toEqual([])
  })
})

describe('add-ons on the till follow the snapshot links (no spurious reprice_mismatch)', () => {
  it("offers and prices only the drink's own groups", () => {
    const linked: MenuSnapshot = {
      ...snapshot,
      categories: [{ ...snapshot.categories[0]!, items: [
        { ...snapshot.categories[0]!.items[0]!, optionGroupIds: ['g-milk'] },
        { ...snapshot.categories[0]!.items[0]!, id: 'i-amer', name: 'Americano', optionGroupIds: [] },
      ] }],
      optionGroups: [{ id: 'g-milk', name: 'Milk', minSelect: 0, maxSelect: 1, options: [{ id: 'o-oat', name: 'Oat', priceCentavos: 2000, isAvailable: true }] }],
    }
    const menu = tillMenu(linked, builtInMenu(0), new Set(), 0)
    const items = menu.categories[0]!.items
    expect(groupsFor(menu, items[0]!).map((g) => g.id)).toEqual(['g-milk'])
    expect(groupsFor(menu, items[1]!)).toEqual([])
    const line = (menuItemId: string) => ({ menuItemId, size: 'M' as const, modifierIds: ['o-oat'], quantity: 1, iceLevel: 'regular' as const, iceServe: 'mixed' as const, note: '' })
    expect(priceLine(menu, line('i-latte')).lineTotalCentavos).toBe(12000)
    expect(() => priceLine(menu, line('i-amer'))).toThrow('One of the add-ons is no longer on the menu.')
  })
})

describe('fetchApiMenu', () => {
  it('returns the raw snapshot (Ruling 11: the till saves it as it came)', async () => {
    const fetchMock = reply(200, snapshot)
    vi.stubGlobal('fetch', fetchMock)
    const got = await fetchApiMenu('https://api.example.test/', 42)
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.example.test/v1/menu')
    expect(got).toEqual(snapshot)
  })

  it('refuses an answer that is not a snapshot', async () => {
    vi.stubGlobal('fetch', reply(200, { categories: 'nope' }))
    await expect(fetchApiMenu('https://api.example.test', 0)).rejects.toThrow('The website gave a menu the till could not understand, so the current menu was kept.')
  })

  it('a snapshot with no drinks keeps the current menu', async () => {
    vi.stubGlobal('fetch', reply(200, { ...snapshot, categories: [snapshot.categories[1]!] }))
    await expect(fetchApiMenu('https://api.example.test', 0)).rejects.toThrow('The website menu came back empty, so the current menu was kept.')
  })

  it('an empty menu keeps the current one with the message above', async () => {
    vi.stubGlobal('fetch', reply(200, { ...snapshot, categories: [] }))
    await expect(fetchApiMenu('https://api.example.test', 0)).rejects.toThrow('The website menu came back empty, so the current menu was kept.')
  })

  it('a 404 NO_MENU is treated as empty', async () => {
    vi.stubGlobal('fetch', reply(404, { code: 'NO_MENU' }))
    await expect(fetchApiMenu('https://api.example.test', 0)).rejects.toThrow('The website menu came back empty, so the current menu was kept.')
  })

  it('other statuses are refused with the code', async () => {
    vi.stubGlobal('fetch', reply(500, {}))
    await expect(fetchApiMenu('https://api.example.test', 0)).rejects.toThrow('The website refused the menu request (500).')
  })

  it('a network failure says the website could not be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(fetchApiMenu('https://api.example.test', 0)).rejects.toThrow('Could not reach the website. Check the internet and try again.')
  })

  it('no api url means the connection is not set up', async () => {
    await expect(fetchApiMenu('', 0)).rejects.toThrow('The website connection is not set up on this computer.')
  })
})

const withMilk: MenuSnapshot = {
  ...snapshot,
  categories: [{
    id: 'c-drinks', name: 'Drinks', kind: 'drink',
    items: [
      {
        id: 'A', name: 'Americano', description: null, imagePath: null, isBestseller: false, isAvailable: true, optionGroupIds: ['g-milk'],
        variants: [{ id: 'A-M', code: 'M', label: 'Medium', priceCentavos: 9000, temperature: 'iced', isAvailable: true }],
      },
      {
        id: 'B', name: 'Breve', description: null, imagePath: null, isBestseller: false, isAvailable: true, optionGroupIds: ['g-milk'],
        variants: [
          { id: 'B-M', code: 'M', label: 'Medium', priceCentavos: 12000, temperature: 'iced', isAvailable: true },
          { id: 'B-L', code: 'L', label: 'Large', priceCentavos: 13500, temperature: 'iced', isAvailable: true },
        ],
      },
    ],
  }],
  optionGroups: [{
    id: 'g-milk', name: 'Milk', minSelect: 0, maxSelect: 1,
    options: [
      { id: 'oat', name: 'Oat', priceCentavos: 2000, isAvailable: true },
      { id: 'soy', name: 'Soy', priceCentavos: 2000, isAvailable: true },
    ],
  }],
}

describe('tillMenu', () => {
  it('builds from the snapshot with items, variants and options in soldOut marked off', () => {
    const fallback = builtInMenu(1)
    const menu = tillMenu(withMilk, fallback, new Set(['A', 'B-L', 'oat']), 77)
    const items = menu.categories.flatMap((c) => c.items)
    expect(menu.version).toBe(3)
    expect(menu.source).toBe('website')
    expect(menu.updatedAt).toBe(77)
    expect(items.find((i) => i.id === 'A')!.isAvailable).toBe(false)
    const b = items.find((i) => i.id === 'B')!
    expect(b.isAvailable).toBe(true)
    expect(b.prices).toEqual([{ size: 'M', priceCentavos: 12000 }])
    const milk = menu.modifierGroups.find((g) => g.id === 'g-milk')!
    expect(milk.modifiers.find((m) => m.id === 'oat')!.isAvailable).toBe(false)
    expect(milk.modifiers.find((m) => m.id === 'soy')!.isAvailable).toBe(true)
    // The saved snapshot itself is not changed.
    expect(withMilk.categories[0]!.items[0]!.isAvailable).toBe(true)
    expect(withMilk.optionGroups[0]!.options[0]!.isAvailable).toBe(true)
  })

  it('without a snapshot uses the fallback with item-level marks and no version', () => {
    const fallback = builtInMenu(5)
    const first = fallback.categories[0]!.items[0]!
    const menu = tillMenu(null, fallback, new Set([first.id]), 77)
    expect(menu.version).toBeUndefined()
    expect(menu.source).toBe('built-in')
    expect(menu.categories[0]!.items[0]!.isAvailable).toBe(false)
    expect(menu.categories[0]!.items[1]!.isAvailable).toBe(true)
    expect(fallback.categories[0]!.items[0]!.isAvailable).toBe(true)
  })
})

describe('tillDiscounts (Ruling 13)', () => {
  const config = [{ label: 'Senior / PWD 20%', kind: 'percent' as const, value: 20 }]
  afterEach(() => vi.restoreAllMocks())

  it('uses the snapshot presets when there are any', () => {
    const s = { ...snapshot, discountPresets: [{ id: 'd1', label: 'Promo 15%', kind: 'percent' as const, value: 15 }, { id: 'd2', label: 'Less 50', kind: 'amount' as const, value: 5000 }] }
    expect(tillDiscounts(s, config)).toEqual([{ label: 'Promo 15%', kind: 'percent', value: 15 }, { label: 'Less 50', kind: 'amount', value: 5000 }])
  })

  it('uses config.json without a snapshot or with no presets', () => {
    expect(tillDiscounts(null, config)).toEqual(config)
    expect(tillDiscounts(snapshot, config)).toEqual(config)
  })

  it('drops non-whole presets and says so once (Ruling P4-4)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = { ...snapshot, discountPresets: [{ id: 'd1', label: 'Odd 12.5%', kind: 'percent' as const, value: 12.5 }, { id: 'd2', label: 'Promo 10%', kind: 'percent' as const, value: 10 }] }
    expect(tillDiscounts(s, config)).toEqual([{ label: 'Promo 10%', kind: 'percent', value: 10 }])
    tillDiscounts(s, config)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toContain('Odd 12.5%')
  })

  it('falls back to config.json when every preset is dropped', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = { ...snapshot, discountPresets: [{ id: 'd9', label: 'Weird', kind: 'percent' as const, value: 0.5 }] }
    expect(tillDiscounts(s, config)).toEqual(config)
  })
})

describe('loadSnapshot', () => {
  const dirs: string[] = []
  afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }) })

  it('is null for a garbled file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kennko-menu-'))
    dirs.push(dir)
    fs.writeFileSync(path.join(dir, 'menu-snapshot.json'), '{"version": 3, "categ')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(loadSnapshot(nodeFiles(dir))).toBeNull()
    warn.mockRestore()
  })
})
