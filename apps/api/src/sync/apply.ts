import type { SyncEvent, SyncEventKind } from '@kennko/core'
import type postgres from 'postgres'
import type { OrderPushEvent } from '../push/notify.js'
import { applyCancelled, applyOrderCreated, applyPrepStatus } from './counter-order.js'
import { applyCustomerLinked, applyCustomerUnlinked, applyRewardUsed, applyStampAdded } from './loyalty-events.js'

/** `notify`: the customer push a real online prep move owes, sent only after the push transaction commits. */
export type Applied = {
  result: 'applied' | 'flagged' | 'held'
  reason: string | null
  flags: string[]
  notify?: { orderId: string; event: OrderPushEvent }
}

type Tx = postgres.TransactionSql
type EventOf<K extends SyncEventKind> = Extract<SyncEvent, { kind: K }>
/** `staffId` is the event's, or null when no such staff member exists. */
type Handler<K extends SyncEventKind> = (tx: Tx, deviceId: string, event: EventOf<K>, staffId: string | null, now: Date) => Promise<Applied>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const applied = (reason: string | null = null): Applied => ({ result: 'applied', reason, flags: [] })
const held = (reason: string): Applied => ({ result: 'held', reason, flags: [] })
const flagged = (reason: string, flags: string[] = []): Applied => ({ result: 'flagged', reason, flags })

const payloadOf = (event: { payload: unknown }) => (event.payload ?? {}) as Record<string, unknown>
const key = (prefix: string, value: unknown) => (typeof value === 'string' && value !== '' ? [`${prefix}:${value}`] : [])

/**
 * The entities a held event blocks (`order:<id>`, `shift:<id>`), stored as `sync_events.entity_keys`.
 * A sale blocks only its own order (Ruling P4-2): a held or invalid sale never stalls the shift's
 * other sales, cash moves or close. Reads the payload defensively so a payload that failed
 * validation still keeps its place in line.
 */
export function entityKeys(event: { kind: SyncEventKind; payload: unknown }): string[] {
  const p = payloadOf(event)
  switch (event.kind) {
    case 'order.created':
    case 'order.prep_status':
    case 'order.cancelled':
    case 'customer.linked':
    case 'customer.unlinked':
    case 'stamp.added':
    case 'reward.used':
      return key('order', p.orderId)
    case 'shift.opened':
    case 'shift.closed':
    case 'cash.moved':
      return key('shift', p.shiftId)
    case 'menu.availability':
      return []
  }
}

/**
 * The entities an event waits on: it waits behind an earlier held event that blocks any of them.
 * The same as `entityKeys`, except a sale also waits on its shift. Derived from kind and payload,
 * so it needs no column.
 */
export function waitKeys(event: { kind: SyncEventKind; payload: unknown }): string[] {
  const keys = entityKeys(event)
  return event.kind === 'order.created' ? [...keys, ...key('shift', payloadOf(event).shiftId)] : keys
}

const shiftOpened: Handler<'shift.opened'> = async (tx, deviceId, event, staffId, now) => {
  const { shiftId, openingFloatCentavos } = event.payload
  const [open] = await tx`select 1 from shifts where device_id = ${deviceId} and closed_at is null and id <> ${shiftId}`
  if (open) return held('another_shift_open')
  try {
    // A nested savepoint so a racing open (the shifts_one_open index) can still be answered as held.
    await tx.savepoint((sp) => sp`
      insert into shifts (id, device_id, opened_at, opened_by_staff, opening_float_centavos, received_at, updated_at)
      values (${shiftId}, ${deviceId}, ${event.occurredAt}, ${staffId}, ${openingFloatCentavos}, ${now}, ${now})
      on conflict (id) do nothing`)
  } catch (err) {
    if ((err as { constraint_name?: string }).constraint_name === 'shifts_one_open') return held('another_shift_open')
    throw err
  }
  return applied()
}

const shiftClosed: Handler<'shift.closed'> = async (tx, _deviceId, event, staffId, now) => {
  const { shiftId, countedCentavos, expectedCentavos, note } = event.payload
  // Matched by id, not device: a till paired again mid-shift can still close its own shift.
  const [row] = await tx`
    update shifts set closed_at = ${event.occurredAt}, closed_by_staff = ${staffId}, counted_centavos = ${countedCentavos},
      expected_centavos = ${expectedCentavos}, note = ${note}, updated_at = ${now}
    where id = ${shiftId} and closed_at is null
    returning id`
  if (row) return applied()
  // Closed from admin while the till was stuck (Ruling 3): the till's own count is the better fact.
  const [replaced] = await tx`
    update shifts set closed_at = ${event.occurredAt}, closed_by_staff = ${staffId}, counted_centavos = ${countedCentavos},
      expected_centavos = ${expectedCentavos}, note = ${note}, closed_in_admin = false, updated_at = ${now}
    where id = ${shiftId} and closed_in_admin
    returning id`
  if (replaced) return applied('replaced_admin_close')
  const [exists] = await tx`select 1 from shifts where id = ${shiftId}`
  return exists ? applied('already_closed') : held('shift_unknown')
}

const cashMoved: Handler<'cash.moved'> = async (tx, _deviceId, event, staffId, now) => {
  const { id, shiftId, kind, amountCentavos, reason } = event.payload
  const [shift] = await tx`select 1 from shifts where id = ${shiftId}`
  if (!shift) return held('shift_unknown')
  await tx`
    insert into cash_moves (id, shift_id, kind, amount_centavos, reason, at, staff_id, received_at)
    values (${id}, ${shiftId}, ${kind}, ${amountCentavos}, ${reason}, ${event.occurredAt}, ${staffId}, ${now})
    on conflict (id) do nothing`
  return applied()
}

/** Whichever change the server receives last wins; the stamp trigger sets availability_changed_at. */
const menuAvailability: Handler<'menu.availability'> = async (tx, _deviceId, event) => {
  const { itemId, available } = event.payload
  if (!UUID.test(itemId)) return flagged('unknown_item')
  const [row] = await tx`update menu_items set is_available = ${available} where id = ${itemId} returning id`
  return row ? applied() : flagged('unknown_item')
}

const handlers: { [K in SyncEventKind]: Handler<K> } = {
  'order.created': applyOrderCreated,
  'order.prep_status': applyPrepStatus,
  'order.cancelled': applyCancelled,
  'shift.opened': shiftOpened,
  'shift.closed': shiftClosed,
  'cash.moved': cashMoved,
  'menu.availability': menuAvailability,
  'customer.linked': applyCustomerLinked,
  'customer.unlinked': applyCustomerUnlinked,
  'stamp.added': applyStampAdded,
  'reward.used': applyRewardUsed,
}

/**
 * Applies one event inside the caller's savepoint. A thrown error is the caller's to roll back.
 * An unknown `staffId` is stored as null and, when nothing else is said, answered `unknown_staff`.
 */
export async function applyEvent(tx: Tx, deviceId: string, event: SyncEvent, now: Date): Promise<Applied> {
  let staffId = event.staffId
  let unknownStaff = false
  if (staffId !== null) {
    const [staff] = await tx`select 1 from staff where id = ${staffId}`
    if (!staff) {
      staffId = null
      unknownStaff = true
    }
  }
  const handler = handlers[event.kind] as Handler<SyncEventKind>
  const out = await handler(tx, deviceId, event as EventOf<SyncEventKind>, staffId, now)
  if (unknownStaff && out.result !== 'held') return { ...out, reason: out.reason ? `${out.reason},unknown_staff` : 'unknown_staff' }
  return out
}
