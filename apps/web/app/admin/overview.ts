import type { MenuStatus } from '@/lib/menu/status'

export type OverviewTile = {
  key: 'orders' | 'soldout' | 'menu'
  title: string
  value: string
  href: string
}

type OverviewInput = { ordersToCheck: number; soldOut: number; status: MenuStatus }

function menuValue(status: MenuStatus): string {
  if (!status.ok) return 'Status unavailable'
  if (status.hasUnpublishedChanges || status.publishedVersion === null) return 'Unpublished changes'
  return `Version ${status.publishedVersion}`
}

export function overviewTiles({ ordersToCheck, soldOut, status }: OverviewInput): OverviewTile[] {
  return [
    { key: 'orders', title: 'Orders to check', value: String(ordersToCheck), href: '/admin/orders?tab=check' },
    { key: 'soldout', title: 'Sold out now', value: String(soldOut), href: '/admin/menu?filter=soldout' },
    { key: 'menu', title: 'Menu', value: menuValue(status), href: '/admin/menu' },
  ]
}
