/**
 * Kennko is in Manila: every pickup or delivery time is shown in Manila time, never the server's
 * zone (Vercel runs in UTC) or the viewer's.
 */
export function formatManilaDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/**
 * A `datetime-local` input gives `2026-11-21T12:00` with no zone. The order form sends it marked as
 * Manila time so no server can read it as UTC (the API also treats an offset-less value as Manila).
 */
export function withManilaOffset(value: string): string {
  if (!value || /(Z|[+-]\d{2}:\d{2})$/.test(value)) return value
  return `${value}+08:00`
}
