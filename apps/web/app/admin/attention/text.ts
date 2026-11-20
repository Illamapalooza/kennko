const HELD: Record<string, string> = {
  another_shift_open: 'Waiting: this till still has an open shift on Kennko',
  shift_unknown: 'Waiting for its shift to arrive',
  order_unknown: 'Waiting for its sale to arrive',
  waits_for_earlier: 'Waiting behind another problem on the same sale or shift',
}

const FLAGGED: Record<string, string> = {
  already_recorded_differs: 'Sent again with different totals',
  not_for_counter: 'Sent for an order that is not a counter order',
  online_order: 'Sent for an online order, which the till does not handle',
  not_paid: 'Sent for an order that was not paid',
  not_from_till: 'Sent for an order that did not come from this till',
  unknown_item: 'Sold an item the menu does not have',
}

const ORDER_FLAGS: Record<string, string> = {
  reprice_mismatch: 'Total differs from the menu prices',
  unknown_version: 'Sent by a till version the server does not know',
  ticket_duplicate: 'Ticket number already used',
  clock_skew: "The till's clock looked wrong",
}

/** A receipt's reason in plain words. `result` tells a flagged reason (a comma list of flags) from a held one. */
export function reasonText(result: string, reason: string | null): string {
  if (!reason) return ''
  if (result === 'flagged') return reason.split(',').map((r) => FLAGGED[r] ?? r).join('; ')
  const known = HELD[reason]
  if (known) return known
  if (reason.startsWith('invalid: legacy: ')) return `Old record that could not be stored: ${reason.slice('invalid: legacy: '.length)}`
  if (reason.startsWith('invalid: ')) return `Can't be stored as sent: ${reason.slice('invalid: '.length)}`
  if (reason.startsWith('error: ')) return `Failed, will try again: ${reason.slice('error: '.length)}`
  return FLAGGED[reason] ?? reason
}

/** A flagged order's flag in plain words. */
export function flagText(flag: string): string {
  return ORDER_FLAGS[flag] ?? flag
}
