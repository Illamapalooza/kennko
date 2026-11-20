'use server'

import { revalidatePath } from 'next/cache'
import { requireManager, requireOwner } from '@/lib/auth/session'
import { callApiWithCode } from '@/lib/api/call'
import { parsePoints } from './points'

type Result = { ok: true } | { ok: false; message: string }
type PointsResult = { ok: true; points: number | null } | { ok: false; message: string }

const CONFLICTS: Record<string, string> = {
  FREE_DRINK_WAITING: 'They have a free drink waiting. Claim it at the till first.',
  STILL_PAPER: 'Switch them to the digital card first.',
  NOT_OPEN: 'That was already dealt with. Refresh.',
}

const NOTE_MAX = 200
const id = encodeURIComponent

function refresh(customerId?: string) {
  revalidatePath('/admin/customers')
  if (customerId) revalidatePath(`/admin/customers/${customerId}`)
}

async function send(path: string, body: unknown, forbidden: string) {
  const result = await callApiWithCode(path, 'POST', body, { forbidden })
  if (result.ok) return result
  return { ok: false as const, message: (result.code && CONFLICTS[result.code]) || result.message }
}

/** Manager or owner: switch a customer between the digital and the paper card. */
export async function setStampMode(customerId: string, mode: 'digital' | 'paper'): Promise<Result> {
  await requireManager()
  const out = await send(`/v1/customers/${id(customerId)}/stamp-mode`, { mode }, 'Only a manager or the owner can do that.')
  if (!out.ok) return out
  refresh(customerId)
  return { ok: true }
}

/** Owner only: add or take off points, with the reason kept on the ledger. */
export async function adjustPoints(customerId: string, deltaText: string, note: string): Promise<PointsResult> {
  await requireOwner()
  const delta = parsePoints(deltaText)
  if (delta === null) return { ok: false, message: 'Enter whole points, up to 10,000.' }
  const clean = note.trim()
  if (!clean || clean.length > NOTE_MAX) return { ok: false, message: 'Say why.' }
  const out = await send(`/v1/customers/${id(customerId)}/points`, { delta, note: clean }, 'Only the owner can adjust points.')
  if (!out.ok) return out
  refresh(customerId)
  const points = (out.body as { points?: unknown } | null)?.points
  return { ok: true, points: typeof points === 'number' ? points : null }
}

async function resolve(action: 'apply' | 'discard', stampId: string): Promise<Result> {
  await requireManager()
  const out = await send(`/v1/stamps/${id(stampId)}/${action}`, {}, 'Only a manager or the owner can do that.')
  if (!out.ok) return out
  // The stamp's customer is not known here, so refresh every customer page as well as Needs a look.
  revalidatePath('/admin/customers', 'layout')
  revalidatePath('/admin/attention')
  return { ok: true }
}

/** Puts a paper-mode stamp on the customer's digital card (they must be digital again first). */
export async function applyStamp(stampId: string): Promise<Result> {
  return resolve('apply', stampId)
}

/** Sets a paper-mode stamp aside. */
export async function discardStamp(stampId: string): Promise<Result> {
  return resolve('discard', stampId)
}
