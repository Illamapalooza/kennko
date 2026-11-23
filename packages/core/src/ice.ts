import type { DrinkSize } from './menu.ts'

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

/** Hot drinks and food have no ice to configure. */
export function takesIce(size: DrinkSize): boolean {
  return size !== 'HOT' && size !== 'REG'
}

/** "Ice on the side" is meaningless when there is no ice. */
export function takesIceServe(size: DrinkSize, level: IceLevel | null): boolean {
  return takesIce(size) && level !== null && level !== 'none'
}

/** Normalises a selection against the size, so switching M -> HOT cannot leave a stale ice instruction. */
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

/** Full wording for a customer-facing summary, e.g. "Less ice, on the side". */
export function iceSummary(level: IceLevel | null, serve: IceServe | null): string | null {
  if (!level) return null
  if (level === 'none') return 'No ice'
  const amount = level === 'less' ? 'Less ice' : 'Regular ice'
  return serve === 'side' ? `${amount}, on the side` : amount
}

/** Short kitchen wording; regular ice mixed in is the default and says nothing. */
export function iceLabel(level: IceLevel | null, serve: IceServe | null): string {
  const parts: string[] = []
  if (level === 'less') parts.push('Less ice')
  if (level === 'none') parts.push('No ice')
  if (serve === 'side') parts.push('Ice on the side')
  return parts.join(', ')
}
