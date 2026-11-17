import type { DrinkSize } from '@/lib/menu/types'
import type { IceLevel, IceServe } from './ice'

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
  iceLevel: IceLevel | null
  iceServe: IceServe | null
  note: string
}

export type Fulfilment = 'pickup' | 'delivery'
