import {
  DEFAULT_CLOSING_TIME,
  DEFAULT_SHOP_STATUS,
  isShopOpenNow,
  isValidClosingTime,
  type ShopStatus,
} from '@kennko/core'
import type postgres from 'postgres'

type ShopStatusRow = {
  is_open: boolean
  closing_time: string | null
  shop_status_updated_at: Date
}

export async function readShopStatus(sql: postgres.Sql): Promise<ShopStatus> {
  const [row] = await sql<ShopStatusRow[]>`
    select is_open, closing_time, shop_status_updated_at from shop_settings where id = 1`
  if (!row) return DEFAULT_SHOP_STATUS
  return {
    isOpen: row.is_open,
    closingTime: row.closing_time ?? null,
    updatedAt: new Date(row.shop_status_updated_at).getTime(),
  }
}

export async function updateShopStatus(
  sql: postgres.Sql,
  patch: { isOpen?: boolean; closingTime?: string | null },
  now: Date,
): Promise<ShopStatus> {
  const current = await readShopStatus(sql)
  const nextIsOpen = patch.isOpen ?? current.isOpen
  const nextClosingTime =
    patch.closingTime === undefined
      ? current.closingTime
      : patch.closingTime === null
        ? null
        : isValidClosingTime(patch.closingTime)
          ? patch.closingTime
          : DEFAULT_CLOSING_TIME

  const [row] = await sql<ShopStatusRow[]>`
    update shop_settings
    set is_open = ${nextIsOpen},
        closing_time = ${nextClosingTime},
        shop_status_updated_at = ${now}
    where id = 1
    returning is_open, closing_time, shop_status_updated_at`
  if (!row) return { isOpen: nextIsOpen, closingTime: nextClosingTime, updatedAt: now.getTime() }
  return {
    isOpen: row.is_open,
    closingTime: row.closing_time ?? null,
    updatedAt: new Date(row.shop_status_updated_at).getTime(),
  }
}

export function withOpenNow(status: ShopStatus, nowMs: number) {
  return { ...status, openNow: isShopOpenNow(status, nowMs) }
}
