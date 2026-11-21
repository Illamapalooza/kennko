import QRCode from 'qrcode'
import { checkinLink, wallCode, wallMinute } from '@kennko/core'
import type { Store } from './store.ts'

/** What the wall may show for the check-in: the link and its QR modules. Never the secret. */
export type WallCheckin = { url: string; modules: string[]; minute: number }

/**
 * How far Kennko's clock is ahead of the till's, as last measured and persisted by the sync (`checkin_skew`), so a
 * restart while offline still knows the server's minute (Ruling 6). null before the first answer.
 */
export function storedSkew(store: Store): number | null {
  const raw = store.kvGet('checkin_skew')
  if (raw === null) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) ? n : null
}

/** Milliseconds from `now` (the till's clock) to the next whole minute of the server's (`now + skew`). Never 0. */
export function msToNextMinute(now: number, skew: number): number {
  const into = (((now + skew) % 60_000) + 60_000) % 60_000
  return 60_000 - into
}

const memo = new WeakMap<Store, { key: string; value: Promise<WallCheckin> }>()

/**
 * The wall's check-in for the server's current minute (Ruling 5/6): `wallCode` of the pulled secret, as a link and the
 * QR modules (rows of '0'/'1', made here so the wall needs no QR library). null without a secret or a measured skew;
 * the wall then shows no QR. Memoised per minute, secret and URL; the secret never leaves this function.
 */
export async function currentCheckin(store: Store, now: number): Promise<WallCheckin | null> {
  const config = store.checkinConfig()
  const skew = storedSkew(store)
  if (!config || skew === null) return null
  const minute = wallMinute(now + skew)
  const key = `${minute}\n${config.url}\n${config.secret}`
  const hit = memo.get(store)
  if (hit && hit.key === key) return hit.value
  const value = (async (): Promise<WallCheckin> => {
    const url = checkinLink(config.url, await wallCode(config.secret, minute))
    const { size, data } = QRCode.create(url, { errorCorrectionLevel: 'M' }).modules
    const modules: string[] = []
    for (let r = 0; r < size; r++) {
      let row = ''
      for (let c = 0; c < size; c++) row += data[r * size + c] ? '1' : '0'
      modules.push(row)
    }
    return { url, modules, minute }
  })()
  memo.set(store, { key, value })
  // A failed computation is not kept, so the next frame tries again.
  value.catch(() => { if (memo.get(store)?.value === value) memo.delete(store) })
  return value
}
