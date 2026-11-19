import type { MenuSnapshot } from '@kennko/core'

let warned = false

/**
 * The published menu, from the API. Returns null when nothing is published
 * (404 NO_MENU) or when KENNKO_API_URL is not set, so builds and tests work
 * without an API. Any other failure throws.
 *
 * `fresh: true` bypasses Next's data cache (`cache: 'no-store'`). Checkout
 * uses it: the cached path is stale-while-revalidate, so it can serve an
 * arbitrarily old copy, and an order must be priced against the live menu.
 */
export type FetchMenuOptions = { fresh?: boolean }

export async function fetchMenuSnapshot(
  options: FetchMenuOptions = {},
): Promise<MenuSnapshot | null> {
  const base = process.env.KENNKO_API_URL
  if (!base) {
    if (!warned) {
      warned = true
      console.warn('KENNKO_API_URL is not set; the menu will be empty')
    }
    return null
  }

  const res = await fetch(`${base.replace(/\/+$/, '')}/v1/menu`, {
    ...(options.fresh ? { cache: 'no-store' as const } : { next: { revalidate: 30 } }),
    signal: AbortSignal.timeout(5000),
  })
  if (res.status === 404) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null
    if (body?.code === 'NO_MENU') return null
  }
  if (!res.ok) throw new Error(`Failed to load menu: API responded ${res.status}`)
  return (await res.json()) as MenuSnapshot
}
