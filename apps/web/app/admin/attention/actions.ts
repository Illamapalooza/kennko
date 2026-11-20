'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth/session'
import { callApiWithCode } from '@/lib/api/call'
import { parsePesos } from './pesos'

type Result = { ok: true } | { ok: false; message: string }

const MESSAGES = {
  forbidden: 'Only the owner can do that.',
  notFound: 'That no longer exists. Refresh the page.',
}

/** What each 409 code from the attention routes means to the owner. */
const CONFLICTS: Record<string, string> = {
  ALREADY_CLOSED: 'That shift is already closed. Refresh.',
  NOT_OPEN: 'That was already dealt with. Refresh.',
  NOT_HELD: 'That receipt was already dealt with, or is not held. Refresh.',
  NOT_FLAGGED: 'That has nothing to look at any more. Refresh.',
}

const NOTE_MAX = 200
const NO_NOTE = 'Write a short note (up to 200 characters).'

const path = (...parts: string[]) => `/v1/attention/${parts.map(encodeURIComponent).join('/')}`

async function send(to: string, body?: unknown): Promise<Result> {
  const result = await callApiWithCode(to, 'POST', body ?? {}, MESSAGES)
  if (!result.ok) return { ok: false, message: (result.code && CONFLICTS[result.code]) || result.message }
  revalidatePath('/admin/attention')
  return { ok: true }
}

const cleanNote = (note: string) => {
  const trimmed = note.trim()
  return trimmed && trimmed.length <= NOTE_MAX ? trimmed : null
}

async function resolve(action: 'discard' | 'seen', deviceId: string, eventId: string, note: string): Promise<Result> {
  await requireOwner()
  const clean = cleanNote(note)
  if (!clean) return { ok: false, message: NO_NOTE }
  return send(path('events', deviceId, eventId), { action, note: clean })
}

/** Sets a held receipt aside. The sale's ticket and total stay on the report. */
export async function discardEvent(deviceId: string, eventId: string, note: string): Promise<Result> {
  return resolve('discard', deviceId, eventId, note)
}

/** Marks a flagged receipt as looked at. */
export async function markEventSeen(deviceId: string, eventId: string, note: string): Promise<Result> {
  return resolve('seen', deviceId, eventId, note)
}

/** Asks the server to retry that till's held receipts now. */
export async function retryTill(deviceId: string): Promise<Result> {
  await requireOwner()
  return send(path('devices', deviceId, 'retry'))
}

/** Closes a stuck open shift with the cash counted (pesos as typed) and a reason. */
export async function closeShift(shiftId: string, countedPesos: string, note: string): Promise<Result> {
  await requireOwner()
  const counted = parsePesos(countedPesos)
  if (counted === null) return { ok: false, message: 'Enter the counted cash in pesos.' }
  const clean = cleanNote(note)
  if (!clean) return { ok: false, message: NO_NOTE }
  return send(path('shifts', shiftId, 'close'), { countedCentavos: counted, note: clean })
}

/** Marks that the owner has looked at a flagged order. */
export async function markOrderSeen(orderId: string): Promise<Result> {
  await requireOwner()
  return send(path('orders', orderId, 'seen'))
}
