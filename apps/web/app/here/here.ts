/** Pure helpers for /here (the page that the wall's QR opens). `actions.ts` is 'use server' and may only export async functions. */

const WALL_CODE = /^[a-z2-7]{8}$/

/** The `c` query value, or null unless it is exactly 8 lower-case base32 characters (a repeated `?c=` is refused). */
export function parseWallCode(raw: string | string[] | null | undefined): string | null {
  return typeof raw === 'string' && WALL_CODE.test(raw) ? raw : null
}

/** Where a signed-out customer signs in so that they land back here. Built encoded; `/account` passes it through safeNextPath. */
export function hereNextPath(code: string): string {
  return `/account?next=${encodeURIComponent(`/here?c=${code}`)}`
}

export type CheckinReason = 'BAD_WALL_CODE' | 'RATE_LIMITED' | 'NOT_JOINED' | 'NO_CODE' | 'FAILED'
export type CheckinResult =
  | { status: 'ok'; onWall: boolean; endsAt: string }
  | { status: 'error'; reason: CheckinReason }

export type CheckinMessage = {
  tone: 'good' | 'bad'
  title: string
  detail?: string
  link?: { href: string; label: string }
}

const timeFormat = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })

/** What the customer reads after tapping "Walk my cat in". */
export function checkinMessage(result: CheckinResult, catName: string): CheckinMessage {
  if (result.status === 'ok') {
    const until = `Your visit lasts until ${timeFormat.format(new Date(result.endsAt))}.`
    if (result.onWall) return { tone: 'good', title: `${catName} is walking in. Look at the wall!`, detail: until }
    return {
      tone: 'good',
      title: 'Checked in. Your cat is set to stay home.',
      detail: until,
      link: { href: '/account', label: 'Turn on "Show me on the wall"' },
    }
  }
  switch (result.reason) {
    case 'BAD_WALL_CODE':
      return { tone: 'bad', title: 'That code has changed. Scan the wall again.' }
    case 'RATE_LIMITED':
      return { tone: 'bad', title: 'Give it a minute and try again.' }
    case 'NOT_JOINED':
      return { tone: 'bad', title: 'Get your Kennko card first.', link: { href: '/account', label: 'Get my Kennko card' } }
    case 'NO_CODE':
      return { tone: 'bad', title: 'Scan the QR code on the wall at Kennko.' }
    default:
      return { tone: 'bad', title: 'We could not check you in. Try again.' }
  }
}
