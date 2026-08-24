import type { DrinkSize } from '@/lib/menu/types'

export type CartModifier = {
  id: string
  name: string
  priceCentavos: number
}

export type CartLine = {
  lineId: string
  menuItemId: string
  name: string
  size: DrinkSize
  basePriceCentavos: number
  modifiers: CartModifier[]
  quantity: number
}

export type Fulfilment = 'pickup' | 'delivery'
