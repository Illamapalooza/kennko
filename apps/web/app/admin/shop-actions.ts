'use server'

import { revalidatePath } from 'next/cache'
import { staffFetch } from '@/lib/api/client'
import { requireStaff } from '@/lib/auth/session'

export type ShopStatusState = {
  isOpen: boolean
  closingTime: string | null
  updatedAt: number
  openNow: boolean
}

export async function updateShopStatusAction(patch: {
  isOpen?: boolean
  closingTime?: string | null
}): Promise<{ ok: true; status: ShopStatusState } | { ok: false; error: string }> {
  await requireStaff()
  const res = await staffFetch('/v1/shop', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    return { ok: false, error: body?.message ?? 'Could not update shop hours.' }
  }
  const status = (await res.json()) as ShopStatusState
  revalidatePath('/admin')
  revalidatePath('/cafe')
  return { ok: true, status }
}
