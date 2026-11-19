import { describe, expect, it } from 'vitest'
import { overviewTiles } from './overview'

const published = { ok: true, publishedVersion: 4, publishedAt: null, hasUnpublishedChanges: false } as const

describe('overviewTiles', () => {
  it('returns the three tiles with their links', () => {
    const tiles = overviewTiles({ ordersToCheck: 2, soldOut: 5, status: published })
    expect(tiles).toEqual([
      { key: 'orders', title: 'Orders to check', value: '2', href: '/admin/orders?tab=check' },
      { key: 'soldout', title: 'Sold out now', value: '5', href: '/admin/menu?filter=soldout' },
      { key: 'menu', title: 'Menu', value: 'Version 4', href: '/admin/menu' },
    ])
  })

  it('shows unpublished changes', () => {
    const tiles = overviewTiles({
      ordersToCheck: 0,
      soldOut: 0,
      status: { ...published, hasUnpublishedChanges: true },
    })
    expect(tiles[2].value).toBe('Unpublished changes')
  })

  it('falls back when the status is unavailable', () => {
    const tiles = overviewTiles({ ordersToCheck: 0, soldOut: 0, status: { ok: false } })
    expect(tiles[2].value).toBe('Status unavailable')
  })

  it('shows Unpublished when there is no published version yet', () => {
    const tiles = overviewTiles({
      ordersToCheck: 0,
      soldOut: 0,
      status: { ok: true, publishedVersion: null, publishedAt: null, hasUnpublishedChanges: false },
    })
    expect(tiles[2].value).toBe('Unpublished changes')
  })
})
