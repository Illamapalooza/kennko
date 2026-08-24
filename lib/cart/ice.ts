import type { DrinkSize } from '@/lib/menu/types'

export type IceLevel = 'regular' | 'less' | 'none'
export type IceServe = 'mixed' | 'side'

export const ICE_LEVELS: { value: IceLevel; label: string }[] = [
  { value: 'regular', label: 'Regular ice' },
  { value: 'less', label: 'Less ice' },
  { value: 'none', label: 'No ice' },
]

export const ICE_SERVES: { value: IceServe; label: string; hint: string }[] = [
  { value: 'mixed', label: 'Mixed in', hint: 'Poured over ice, ready to drink' },
  { value: 'side', label: 'Ice on the side', hint: 'Keeps it from watering down' },
]

/** Hot drinks have no ice to configure. */
export function takesIce(size: DrinkSize): boolean {
  return size !== 'HOT'
}

/** "Ice on the side" is meaningless when there is no ice. */
export function takesIceServe(size: DrinkSize, level: IceLevel | null): boolean {
  return takesIce(size) && level !== null && level !== 'none'
}

/**
 * Normalises a selection against the size, so switching M -> HOT cannot leave
 * a stale ice instruction attached to a hot drink.
 */
export function normaliseIce(
  size: DrinkSize,
  level: IceLevel | null,
  serve: IceServe | null,
): { level: IceLevel | null; serve: IceServe | null } {
  if (!takesIce(size)) return { level: null, serve: null }
  const resolvedLevel: IceLevel = level ?? 'regular'
  if (resolvedLevel === 'none') return { level: 'none', serve: null }
  return { level: resolvedLevel, serve: serve ?? 'mixed' }
}

export function iceSummary(level: IceLevel | null, serve: IceServe | null): string | null {
  if (!level) return null
  if (level === 'none') return 'No ice'
  const amount = level === 'less' ? 'Less ice' : 'Regular ice'
  return serve === 'side' ? `${amount}, on the side` : amount
}
