import { CLOCK_WARN_MS, type Menu } from '@kennko/core'
import type { SyncStatus } from './api.ts'

const connected = (s: SyncStatus) => s.paired && !s.revoked

/** The amber "Offline" pill: only when paired and the last try failed (Ruling 16). Never the push `held` count. */
export function offlineBadge(s: SyncStatus): string | null {
  if (!connected(s) || !s.offline) return null
  if (s.pendingSales > 0) return `Offline: ${s.pendingSales} sale${s.pendingSales === 1 ? '' : 's'} waiting to send`
  return 'Offline: changes waiting to send'
}

/** The website refused a request (so the till is not offline): show why, in amber. */
export function syncProblem(s: SyncStatus): string | null {
  if (!connected(s) || s.offline || !s.problem) return null
  return `Sync problem: ${s.problem}`
}

/** Shown when the till's clock is more than CLOCK_WARN_MS off the website's. Positive skew = the website is ahead. */
export function clockWarning(s: SyncStatus): string | null {
  const skew = s.clockSkewMs
  if (skew === null || Math.abs(skew) <= CLOCK_WARN_MS) return null
  const minutes = Math.round(Math.abs(skew) / 60_000)
  return `This computer's clock is ${minutes} minute${minutes === 1 ? '' : 's'} ${skew > 0 ? 'behind' : 'ahead'}. Sales still work; fix the time in Windows settings so reports line up.`
}

const ago = (ms: number) => {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return 'just now'
  return minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`
}

/** The Menu screen's one-line source. Uses the menu's own version: the status one can lag an unpaired manual pull. */
export function menuLine(s: SyncStatus, menu: Menu, now: number = Date.now()): string {
  if (connected(s) && s.importing > 0) return `Copying sales history to Kennko: ${s.importing} left.`
  if (menu.source !== 'website') return 'Using the menu that came with the till.'
  const version = menu.version !== undefined ? `, version ${menu.version}` : ''
  const checked = s.lastSyncAt !== null ? `, checked ${ago(now - s.lastSyncAt)}` : ''
  return `Prices from Kennko${version}${checked}.`
}
