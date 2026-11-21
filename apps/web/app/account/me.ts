import type { CosmeticView, MeView } from '@kennko/core'
import { publicFetch, userFetch } from '@/lib/api/client'

type Card = NonNullable<NonNullable<MeView['customer']>['card']>

export const CARD_SIZE = 8

/** The signed-in customer's card, points and code; `customer` is null until they press "Get my Kennko card". */
export async function loadMe(): Promise<MeView> {
  const res = await userFetch('/v1/me')
  if (res.status !== 200) throw new Error('Could not load your Kennko card')
  return (await res.json()) as MeView
}

const dayFormat = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' })

export type StampCircle = { filled: boolean; date: string | null }

/**
 * Always 8 circles. The open card's stamps come first, with their dates. A full card waiting for its claim
 * fills all eight and raises "Free drink ready".
 */
export function stampCircles(card: Card): { circles: StampCircle[]; freeDrinkReady: boolean } {
  const ready = card.fullCards > 0
  const circles: StampCircle[] = Array.from({ length: CARD_SIZE }, (_, i) => {
    const stamp = card.stamps[i]
    if (stamp) return { filled: true, date: dayFormat.format(new Date(stamp.stampedAt)).replace(/^(\d+) (\w+)$/, '$2 $1') }
    return { filled: ready, date: null }
  })
  return { circles, freeDrinkReady: ready }
}

/** The shop catalogue (public, cached by the API for a minute). An empty shop beats a broken account page. */
export async function loadCosmetics(): Promise<CosmeticView[]> {
  try {
    const res = await publicFetch('/v1/cosmetics')
    if (res.status !== 200) return []
    return (await res.json()) as CosmeticView[]
  } catch (err) {
    console.error('[account] cosmetics failed:', (err as Error).message)
    return []
  }
}
