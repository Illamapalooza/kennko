import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MenuSnapshot } from '@kennko/core'
import { fetchApiMenu } from '../server/menu.ts'

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

describe('fetchApiMenu', () => {
  it('maps a snapshot to drinks only', async () => {
    const fetchMock = reply(200, snapshot)
    vi.stubGlobal('fetch', fetchMock)
    const menu = await fetchApiMenu('https://api.example.test/', 42)
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.example.test/v1/menu')
    expect(menu.categories.map((c) => c.name)).toEqual(['Drinks'])
    expect(menu.categories[0]!.items[0]!.prices).toEqual([{ size: 'M', priceCentavos: 10000 }])
    expect(menu.updatedAt).toBe(42)
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
