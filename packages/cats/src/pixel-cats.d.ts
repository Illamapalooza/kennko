// Types for pixel-cats.js (plain JavaScript so the wall can carry a byte-identical copy).

export type CatSlot = 'coat' | 'hat' | 'face' | 'neck' | 'held'
export type OverlaySlot = Exclude<CatSlot, 'coat'>

export type CatLook = { coat: string; hat?: string; face?: string; neck?: string; held?: string }

export type Cosmetic = {
  slot: OverlaySlot
  /** Character map, '.' is clear. Every row has the same length. */
  rows: string[]
  /** Top-left of the map against the cat's top-left; dy < 0 rises above the cat. */
  dx: number
  dy: number
  colours: Record<string, string>
}

export type CatDrawOptions = {
  flip?: boolean
  apron?: boolean
  blink?: boolean
  /** Draw only the top N rows of the cat (and of its overlays). */
  rows?: number
}

export type CatBounds = { x0: number; y0: number; x1: number; y1: number }

export const INK: string
export const BLUE: string
export const AMBER: string
export const CAT_FRONT: string[]
export const CAT_W: number
export const CAT_H: number
export const COAT_COLOURS: Record<string, Record<string, string>>
export const COAT_KEYS: string[]
export const SLOTS: CatSlot[]
export const COSMETICS: Record<string, Cosmetic>

export function isKnownKey(slot: string, key: string): boolean
export function drawCat(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  look: string | CatLook,
  o?: CatDrawOptions,
): void
export function catBounds(look: string | CatLook): CatBounds
export function drawLoaf(ctx: CanvasRenderingContext2D, x: number, y: number, coatName: string, breathe?: number): void
