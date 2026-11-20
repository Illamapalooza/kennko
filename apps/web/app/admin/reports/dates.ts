const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** A real calendar day as `YYYY-MM-DD` (`2026-02-30` is not one). */
function isDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)

/** Today's date in Manila (UTC+8, no daylight saving), the day the shop's reports run on. */
export function manilaToday(now: number): string {
  return new Date(now + MANILA_OFFSET_MS).toISOString().slice(0, 10)
}

/** The day before and after `date` (`next` is null on today: there is no report for tomorrow), and its label. */
export function dayNav(date: string, today: string): { prev: string; next: string | null; label: string } {
  const label = new Date(`${date}T00:00:00Z`)
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .replace(',', '')
  return { prev: shift(date, -1), next: date < today ? shift(date, 1) : null, label }
}

/** The `?date=` of the page: a real day no later than today, otherwise today. */
export function parseDay(q: string | undefined, today: string): string {
  return q !== undefined && isDay(q) && q <= today ? q : today
}

/** A server time in Manila, `14:05`. */
export function manilaTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Manila' })
}

/** A server time in Manila with its day, `21 Nov, 14:05`. */
export function manilaStamp(iso: string): string {
  const day = new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Manila' })
  return `${day}, ${manilaTime(iso)}`
}
