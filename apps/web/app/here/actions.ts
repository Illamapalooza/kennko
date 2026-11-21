'use server'

import { userFetch } from '@/lib/api/client'
import { parseWallCode, type CheckinResult } from './here'

/**
 * Checks the signed-in customer in with the code from the wall's QR. Called only from the button, never on page load.
 * The code is never logged: failures log the status only.
 */
export async function checkIn(code: string): Promise<CheckinResult> {
  const clean = parseWallCode(code)
  if (!clean) return { status: 'error', reason: 'NO_CODE' }
  let res: Response
  try {
    res = await userFetch('/v1/checkin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: clean }),
    })
  } catch (err) {
    console.error('[here] check-in failed:', (err as Error).message)
    return { status: 'error', reason: 'FAILED' }
  }
  if (res.status === 429) return { status: 'error', reason: 'RATE_LIMITED' }
  const body = (await res.json().catch(() => null)) as { code?: string; onWall?: unknown; endsAt?: unknown } | null
  if (res.ok && typeof body?.onWall === 'boolean' && typeof body.endsAt === 'string') {
    return { status: 'ok', onWall: body.onWall, endsAt: body.endsAt }
  }
  if (body?.code === 'BAD_WALL_CODE') return { status: 'error', reason: 'BAD_WALL_CODE' }
  if (body?.code === 'NOT_JOINED') return { status: 'error', reason: 'NOT_JOINED' }
  console.error('[here] check-in answered', res.status)
  return { status: 'error', reason: 'FAILED' }
}
