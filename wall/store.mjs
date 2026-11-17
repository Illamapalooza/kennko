// Order rules for the Kennko wall. Pure: no clock, no disk. The server owns both.

export const FLOW = ["queued", "preparing", "serving", "done"];
export const MAX_BARISTAS = 3;
export const DEFAULT_AUTOCLEAR_MS = 10 * 60 * 1000;
const NAME_MAX = 16;
const MAX_LINES = 12;
const MAX_QTY = 20;

/** A mistake a barista can make on the pad; the message is shown to them. */
export class OrderError extends Error {}

/** Calendar day in Manila (UTC+8, no daylight saving). */
export function manilaDay(ms) {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export function emptyState(day, baristas = 1) {
  return { day, seq: 0, baristas, orders: [] };
}

function cleanName(name) {
  return String(name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, NAME_MAX);
}

function cleanItems(items, menuNames) {
  if (!Array.isArray(items) || items.length === 0) throw new OrderError("Add at least one drink.");
  const merged = new Map();
  for (const line of items) {
    const name = typeof line?.name === "string" ? line.name : "";
    const qty = line?.qty;
    if (!name || (menuNames && !menuNames.has(name))) throw new OrderError("That drink is not on the menu.");
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new OrderError(`Quantity must be 1 to ${MAX_QTY}.`);
    merged.set(name, (merged.get(name) ?? 0) + qty);
  }
  if (merged.size > MAX_LINES) throw new OrderError("Too many different drinks in one order.");
  for (const qty of merged.values()) if (qty > MAX_QTY) throw new OrderError(`Quantity must be 1 to ${MAX_QTY}.`);
  return [...merged].map(([name, qty]) => ({ name, qty }));
}

function find(state, id) {
  const order = state.orders.find((o) => o.id === id);
  if (!order) throw new OrderError(`Order #${id} was not found.`);
  return order;
}

function replace(state, id, patch, now) {
  return { ...state, orders: state.orders.map((o) => (o.id === id ? { ...o, ...patch, updatedAt: now } : o)) };
}

/** A new day starts a new sheet. A forgotten READY order clears itself. */
function settle(state, now, autoclearMs) {
  const day = manilaDay(now);
  if (state.day !== day) return emptyState(day, state.baristas);
  const stale = state.orders.some((o) => o.status === "serving" && now - o.updatedAt >= autoclearMs);
  if (!stale) return state;
  return {
    ...state,
    orders: state.orders.map((o) =>
      o.status === "serving" && now - o.updatedAt >= autoclearMs ? { ...o, status: "done", updatedAt: now, auto: true } : o),
  };
}

/**
 * @param {object} state
 * @param {{type: string}} action create | advance | undo | cancel | baristas | tick
 * @param {number} now epoch ms
 * @param {{autoclearMs?: number, menuNames?: Set<string>}} [opts]
 * @returns the next state (the same object when nothing changed)
 */
export function reduce(state, action, now, opts = {}) {
  const s = settle(state, now, opts.autoclearMs ?? DEFAULT_AUTOCLEAR_MS);
  switch (action?.type) {
    case "tick":
      return s;
    case "create": {
      const items = cleanItems(action.items, opts.menuNames);
      const id = s.seq + 1;
      const order = { id, name: cleanName(action.name), items, status: "queued", createdAt: now, updatedAt: now };
      return { ...s, seq: id, orders: [...s.orders, order] };
    }
    case "advance": {
      const order = find(s, action.id);
      const i = FLOW.indexOf(order.status);
      if (i === -1 || i === FLOW.length - 1) throw new OrderError(`Order #${order.id} is already finished.`);
      return replace(s, order.id, { status: FLOW[i + 1], auto: undefined }, now);
    }
    case "undo": {
      const order = find(s, action.id);
      if (order.status === "cancelled") {
        return replace(s, order.id, { status: order.prevStatus ?? "queued", prevStatus: undefined }, now);
      }
      const i = FLOW.indexOf(order.status);
      if (i <= 0) throw new OrderError(`Order #${order.id} has nothing to undo.`);
      return replace(s, order.id, { status: FLOW[i - 1], auto: undefined }, now);
    }
    case "cancel": {
      const order = find(s, action.id);
      if (order.status === "done" || order.status === "cancelled") {
        throw new OrderError(`Order #${order.id} is already finished.`);
      }
      return replace(s, order.id, { status: "cancelled", prevStatus: order.status }, now);
    }
    case "baristas": {
      const count = action.count;
      if (!Number.isInteger(count) || count < 0 || count > MAX_BARISTAS) {
        throw new OrderError(`Baristas on shift must be 0 to ${MAX_BARISTAS}.`);
      }
      return count === s.baristas ? s : { ...s, baristas: count };
    }
    default:
      throw new OrderError("Unknown action.");
  }
}

const STATUSES = new Set([...FLOW, "cancelled"]);

/** Validate a state read back from disk. Returns null if it cannot be trusted. */
export function normalize(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.day)) return null;
  if (!Number.isInteger(raw.seq) || raw.seq < 0) return null;
  if (!Number.isInteger(raw.baristas) || raw.baristas < 0 || raw.baristas > MAX_BARISTAS) return null;
  if (!Array.isArray(raw.orders)) return null;
  const orders = [];
  for (const o of raw.orders) {
    if (!o || !Number.isInteger(o.id) || o.id < 1 || o.id > raw.seq) return null;
    if (!STATUSES.has(o.status)) return null;
    if (!Number.isFinite(o.createdAt) || !Number.isFinite(o.updatedAt)) return null;
    if (!Array.isArray(o.items) || o.items.some((l) => typeof l?.name !== "string" || !Number.isInteger(l?.qty))) return null;
    orders.push({
      id: o.id, name: cleanName(o.name), items: o.items.map((l) => ({ name: l.name, qty: l.qty })),
      status: o.status, createdAt: o.createdAt, updatedAt: o.updatedAt,
      ...(STATUSES.has(o.prevStatus) ? { prevStatus: o.prevStatus } : {}),
      ...(o.auto ? { auto: true } : {}),
    });
  }
  return { day: raw.day, seq: raw.seq, baristas: raw.baristas, orders };
}
