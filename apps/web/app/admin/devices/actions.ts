'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth/session'
import { callApi } from '@/lib/api/call'

type Result = { ok: true } | { ok: false; message: string }
type AddResult = { ok: true; code: string; expiresAt: string } | { ok: false; message: string }

const MESSAGES = {
  forbidden: 'Only the owner can add tills.',
  notFound: 'That till no longer exists. Refresh the page.',
}

export async function addTill(name: string): Promise<AddResult> {
  await requireOwner()
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, message: 'Give the till a name.' }

  const result = await callApi('/v1/devices', 'POST', { name: trimmed }, MESSAGES)
  if (!result.ok) return result
  const { code, expiresAt } = (result.body ?? {}) as { code?: unknown; expiresAt?: unknown }
  if (typeof code !== 'string' || typeof expiresAt !== 'string') {
    return { ok: false, message: 'Something went wrong. Try again.' }
  }
  revalidatePath('/admin/devices')
  return { ok: true, code, expiresAt }
}

export async function revokeTill(id: string): Promise<Result> {
  await requireOwner()
  const result = await callApi(`/v1/devices/${encodeURIComponent(id)}`, 'DELETE', undefined, MESSAGES)
  if (!result.ok) return result
  revalidatePath('/admin/devices')
  return { ok: true }
}
