'use server'

import { revalidatePath } from 'next/cache'
import { checkCatName, type CatLook } from '@kennko/core'
import { userFetch } from '@/lib/api/client'

type ActionResult = { ok: true } | { ok: false; message: string }

const TRY_AGAIN = 'We could not reach Kennko. Try again in a minute.'

async function call(path: string, method: string, body?: unknown): Promise<Response | null> {
  try {
    return await userFetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (err) {
    console.error(`[account] ${method} ${path} failed:`, (err as Error).message)
    return null
  }
}

async function failure(res: Response, fallback: string): Promise<ActionResult> {
  const b = (await res.json().catch(() => null)) as { code?: string; message?: string } | null
  switch (b?.code) {
    case 'BAD_NAME':
      return { ok: false, message: b.message ?? 'That name will not do.' }
    case 'NOT_OWNED':
      return { ok: false, message: 'Buy it first.' }
    case 'WRONG_SLOT':
      return { ok: false, message: 'That item does not go there.' }
    case 'NOT_ENOUGH_POINTS':
      return { ok: false, message: b.message ?? 'You need more points for that.' }
    case 'UNKNOWN_COSMETIC':
      return { ok: false, message: 'That item is no longer in the shop.' }
    default:
      return { ok: false, message: fallback }
  }
}

/** Form fields: name, coat, hat/face/neck/held (empty = none) and showOnWall ("on" when the switch is on). */
export async function saveCat(form: FormData): Promise<ActionResult> {
  const checked = checkCatName(String(form.get('name') ?? ''))
  if (!checked.ok) return { ok: false, message: checked.message }
  const look: CatLook = { coat: String(form.get('coat') ?? '') }
  for (const slot of ['hat', 'face', 'neck', 'held'] as const) {
    const v = String(form.get(slot) ?? '')
    if (v) look[slot] = v
  }
  const res = await call('/v1/me/cat', 'PUT', { name: checked.name, look, showOnWall: !!form.get('showOnWall') })
  if (!res) return { ok: false, message: TRY_AGAIN }
  if (!res.ok) return failure(res, 'We could not save your cat. Try again.')
  revalidatePath('/account')
  return { ok: true }
}

export async function buyCosmetic(id: string): Promise<ActionResult> {
  const res = await call(`/v1/me/cosmetics/${encodeURIComponent(id)}/buy`, 'POST')
  if (!res) return { ok: false, message: TRY_AGAIN }
  if (!res.ok) return failure(res, 'We could not buy that. Try again.')
  revalidatePath('/account')
  return { ok: true }
}
