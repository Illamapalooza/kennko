'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth/session'
import { callApiWithCode } from '@/lib/api/call'

type Result = { ok: true } | { ok: false; message: string }
export type CosmeticForm = { name: string; price: string; isActive: boolean; sortOrder: string }

/** Whole points only: "40" is fine, "4.5", "-1" and "1e2" are not. */
const wholeNumber = (s: string, min: number, max: number): number | null => {
  const t = s.trim()
  if (!/^-?\d+$/.test(t)) return null
  const n = Number(t)
  return n >= min && n <= max ? n : null
}

/** Owner only: rename, reprice (points), switch off or reorder one catalogue item. New items need new art in code. */
export async function saveCosmetic(id: string, form: CosmeticForm): Promise<Result> {
  await requireOwner()
  const name = form.name.trim()
  if (!name || name.length > 40) return { ok: false, message: 'Give it a name of 1 to 40 characters.' }
  const pricePoints = wholeNumber(form.price, 0, 10_000)
  if (pricePoints === null) return { ok: false, message: 'The price is whole points, 0 to 10,000.' }
  const sortOrder = wholeNumber(form.sortOrder, -10_000, 10_000)
  if (sortOrder === null) return { ok: false, message: 'The order is a whole number.' }
  const out = await callApiWithCode(
    `/v1/cosmetics/${encodeURIComponent(id)}`,
    'PATCH',
    { name, pricePoints, isActive: form.isActive, sortOrder },
    { forbidden: 'Only the owner can do that.' },
  )
  if (!out.ok) return { ok: false, message: out.code === 'STARTER_ITEM' ? 'Starter items stay free and on.' : out.message }
  revalidatePath('/admin/cosmetics')
  revalidatePath('/account')
  return { ok: true }
}
