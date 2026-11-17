import type { DrinkSize } from './types'

/**
 * Cup volumes, shown wherever a size is offered. HOT is served in the same
 * 12oz cup as M -- the difference is temperature, not quantity, which is worth
 * making explicit so nobody reads the matching price as a mistake.
 */
export const SIZE_VOLUMES: Record<DrinkSize, string> = {
  M: '12oz',
  L: '16oz',
  XL: '22oz',
  HOT: '12oz',
}

export function sizeWithVolume(size: DrinkSize): string {
  return `${size} · ${SIZE_VOLUMES[size]}`
}
