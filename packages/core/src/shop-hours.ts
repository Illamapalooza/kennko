export type ShopStatus = {
  isOpen: boolean
  /** 24-hour Manila time (`"HH:MM"`), or `null` when no automatic closing time is set. */
  closingTime: string | null
  /** Epoch ms when `isOpen` or `closingTime` was last explicitly updated. */
  updatedAt: number
}

export const DEFAULT_CLOSING_TIME = '23:00'

export const DEFAULT_SHOP_STATUS: ShopStatus = {
  isOpen: true,
  closingTime: DEFAULT_CLOSING_TIME,
  updatedAt: 0,
}

const MANILA_OFFSET_MS = 8 * 3_600_000
const DAY_MS = 24 * 3_600_000

export function isValidClosingTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function parseClosingTime(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  return isValidClosingTime(value) ? value : null
}

/** Format `"HH:MM"` (24h) into a friendly 12h string like `"11:00 PM"`. */
export function formatClosingTime(hhmm: string): string {
  const [hRaw, mRaw] = hhmm.split(':')
  const h = Number(hRaw)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${mRaw} ${suffix}`
}

/** Manila day of week (0 = Sun .. 6 = Sat) and minutes since Manila midnight. */
function manilaClock(nowMs: number): { dayOfWeek: number; nowMin: number; dayStartMs: number } {
  const shifted = nowMs + MANILA_OFFSET_MS
  const dayIndex = Math.floor(shifted / DAY_MS)
  const dayStartMs = dayIndex * DAY_MS - MANILA_OFFSET_MS
  const nowMin = Math.floor((shifted - dayIndex * DAY_MS) / 60_000)
  const dayOfWeek = new Date(shifted).getUTCDay()
  return { dayOfWeek, nowMin, dayStartMs }
}

/** Kennko opens at 10:00 AM on weekdays (Mon-Fri) and 3:00 PM on weekends (Sat-Sun). */
export function openingMinutesForDay(dayOfWeek: number): number {
  return dayOfWeek === 0 || dayOfWeek === 6 ? 15 * 60 : 10 * 60
}

/** Friendly next opening label (e.g. `"Opens at 10:00 AM"` or `"Opens tomorrow at 3:00 PM"`). */
export function nextOpeningText(nowMs: number): string {
  const { dayOfWeek, nowMin } = manilaClock(nowMs)
  const todayOpen = openingMinutesForDay(dayOfWeek)
  if (nowMin < todayOpen) {
    return `Opens today at ${todayOpen === 15 * 60 ? '3:00 PM' : '10:00 AM'}`
  }
  const tomorrowDow = (dayOfWeek + 1) % 7
  const tomorrowOpen = openingMinutesForDay(tomorrowDow)
  return `Opens tomorrow at ${tomorrowOpen === 15 * 60 ? '3:00 PM' : '10:00 AM'}`
}

/**
 * Returns true when Kennko is open at `nowMs` (Asia/Manila):
 * - Manual close (`isOpen === false`) always closes immediately.
 * - Opens at 10:00 AM weekdays / 3:00 PM weekends and closes at `closingTime` (default 11:00 PM).
 * - Tapping Open (`updatedAt`) after the most recent close/midnight boundary overrides until the next boundary.
 */
export function isShopOpenNow(status: ShopStatus, nowMs: number): boolean {
  if (!status.isOpen) return false
  const { dayOfWeek, nowMin, dayStartMs } = manilaClock(nowMs)
  const openMin = openingMinutesForDay(dayOfWeek)
  const closeMin = isValidClosingTime(status.closingTime)
    ? (() => {
        const [hh, mm] = status.closingTime.split(':').map(Number)
        return hh! * 60 + mm!
      })()
    : null

  const beforeOpen = nowMin < openMin
  const afterClose = closeMin !== null && (closeMin >= openMin ? nowMin >= closeMin : nowMin >= closeMin && nowMin < openMin)

  if (!beforeOpen && !afterClose) return true

  // Closed by schedule: allow manual Open override if updated after the boundary that started this closed period.
  let boundaryMs = dayStartMs
  if (afterClose && closeMin !== null) {
    const todayCloseMs = dayStartMs + closeMin * 60_000
    boundaryMs = nowMs >= todayCloseMs ? todayCloseMs : todayCloseMs - DAY_MS
  }
  return status.updatedAt > boundaryMs
}
