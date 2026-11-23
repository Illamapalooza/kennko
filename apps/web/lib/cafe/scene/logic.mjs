// Scene bookkeeping with no DOM in it, so it can be tested in node.

export const COATS = ["ginger", "tuxedo", "tabby", "white", "calico", "siamese", "black", "cream"];

/** The same order is the same cat from the door to the table. */
export function coatFor(orderId) {
  return COATS[(orderId * 5 + 2) % COATS.length];
}

/**
 * Which order each barista cat is making. Sticky: a cat keeps its order until it stops preparing;
 * a free cat takes the oldest order nobody has. Orders beyond the cat count simply wait.
 * @param {(number|null)[]} prev previous assignment
 * @param {number[]} preparingIds oldest first
 * @param {number} count baristas on shift
 * @returns {(number|null)[]} length `count`
 */
export function assignBaristas(prev, preparingIds, count) {
  const live = new Set(preparingIds);
  const out = Array.from({ length: Math.max(0, count) }, (_, i) => (live.has(prev?.[i]) ? prev[i] : null));
  const taken = new Set(out.filter((id) => id !== null));
  const waiting = preparingIds.filter((id) => !taken.has(id));
  for (let i = 0; i < out.length && waiting.length; i++) if (out[i] === null) out[i] = waiting.shift();
  return out;
}

/**
 * Sticky numbered spots (waiting places, pickup places, seats). An id keeps its spot; a new id takes the
 * lowest free one; with none free it gets -1.
 * @param {Map<number, number>} prev
 * @param {number[]} ids
 * @param {number} slotCount
 * @returns {Map<number, number>}
 */
export function assignSlots(prev, ids, slotCount) {
  const out = new Map();
  const used = new Set();
  for (const id of ids) {
    const slot = prev?.get(id);
    if (Number.isInteger(slot) && slot >= 0 && slot < slotCount && !used.has(slot)) {
      out.set(id, slot);
      used.add(slot);
    }
  }
  for (const id of ids) {
    if (out.has(id)) continue;
    let slot = -1;
    for (let i = 0; i < slotCount; i++) if (!used.has(i)) { slot = i; break; }
    if (slot >= 0) used.add(slot);
    out.set(id, slot);
  }
  return out;
}

export function itemsLabel(items) {
  return (items ?? []).map((l) => (l.qty > 1 ? `${l.qty}× ${l.name}` : l.name)).join(", ");
}

const byAge = (a, b) => a.updatedAt - b.updatedAt || a.id - b.id;

/** What the board shows: each state's oldest `cap` counter/pickup orders and how many more are hidden. */
export function boardView(orders, cap) {
  const counterOrPickup = orders.filter((o) => o.fulfilment !== "delivery");
  const column = (status, limit) => {
    const all = counterOrPickup.filter((o) => o.status === status).sort(status === "queued" ? (a, b) => a.id - b.id : byAge);
    return { shown: all.slice(0, limit), more: Math.max(0, all.length - limit) };
  };
  return { queued: column("queued", cap * 2), preparing: column("preparing", cap), serving: column("serving", cap) };
}

/** Active online deliveries shown separately above the pixel cafe. */
export function deliveryView(orders) {
  return (orders ?? [])
    .filter((o) => o.fulfilment === "delivery" && o.prepStatus !== "completed" && o.prepStatus !== "cancelled" && o.status !== "cancelled")
    .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
}

export function sceneEvents(prev, next) {
  if (!prev) return [];
  const events = [];
  const prevOrders = new Map((prev.orders ?? []).map((o) => [o.id, o.status]));
  const prevVisitors = new Set((prev.visitors ?? []).map((v) => v.key));
  const nextVisitors = new Set((next.visitors ?? []).map((v) => v.key));

  let hasJoin = false;
  let hasPreparing = false;
  let hasReady = false;
  for (const o of next.orders ?? []) {
    if (o.status === "cancelled") continue;
    const before = prevOrders.get(o.id);
    if (!before && o.status === "queued") hasJoin = true;
    else if (before === "queued" && o.status === "preparing") hasPreparing = true;
    else if (before !== "serving" && o.status === "serving") hasReady = true;
  }

  let hasCatIn = false;
  for (const key of nextVisitors) {
    if (!prevVisitors.has(key)) { hasCatIn = true; break; }
  }
  let hasCatOut = false;
  for (const key of prevVisitors) {
    if (!nextVisitors.has(key)) { hasCatOut = true; break; }
  }

  if (hasJoin) events.push("join");
  if (hasPreparing) events.push("preparing");
  if (hasReady) events.push("ready");
  if (hasCatIn) events.push("catIn");
  if (hasCatOut) events.push("catOut");
  return events;
}

/** Fisher–Yates with an injectable random source. */
export function shuffled(list, random = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------- visiting cats (Plan 8) ----------
export const MAX_VISITORS = 12;

// 3 indoor tables (1-3) + 4 al fresco outdoor tables (4-7). Positions are a cat's feet: centre x, bottom y.
export const TABLES = [
  { x: 48, y: 142 },
  { x: 102, y: 142 },
  { x: 156, y: 142 },
  { x: 210, y: 108 },
  { x: 262, y: 108 },
  { x: 210, y: 142 },
  { x: 262, y: 142 },
];
export const SEAT_SPOTS = TABLES.flatMap((t) => [{ x: t.x - 15, y: t.y }, { x: t.x + 15, y: t.y }]);

/**
 * Where visiting cats stand: the free floor below the counter and between the tables,
 * both indoors and on the al fresco patio. None is on the counter or near a seat.
 */
export const VISIT_SPOTS = [
  ...[24, 62, 100, 138, 174].map((x) => ({ x, y: 113, flip: x > 100 })),
  ...[24, 75, 129].map((x) => ({ x, y: 125, flip: x > 100 })),
  ...[204, 236, 268].map((x) => ({ x, y: 84, flip: true })),
  { x: 236, y: 125, flip: true },
];

/** The visitors still here on the till's clock `now`, newest arrival (latest end) first, at most 12. */
export function visitorView(visitors, now) {
  return (visitors ?? [])
    .filter((v) => Number.isFinite(v?.endsAt) && v.endsAt > now)
    .sort((a, b) => b.endsAt - a.endsAt || (a.key < b.key ? -1 : 1))
    .slice(0, MAX_VISITORS);
}

/** Add this to the wall's own clock to get the till's. 0 when the feed carried no usable time. */
export function clockOffset(tillNow, localNow) {
  return Number.isFinite(tillNow) ? tillNow - localNow : 0;
}

/** Whole pixels per QR module so the code plus its 4-module quiet zone fits `boxPx`. */
export function qrCell(modules, boxPx) {
  return Math.max(1, Math.floor(boxPx / (modules + 8)));
}

// ---------- one cat per customer: an order uses the cat already walking the wall ----------
const LOOK_SLOTS = ["coat", "hat", "face", "neck", "held"];

/** Two looks are the same when every slot matches, whatever order the keys came in. */
export function sameLook(a, b) {
  if (!a || !b) return false;
  return LOOK_SLOTS.every((slot) => (a[slot] ?? null) === (b[slot] ?? null));
}

/**
 * Which visiting cat each order belongs to: order id -> visit key. An order that names its visitor (`visitor`, set
 * by the till) gets that cat. An order that only carries a look takes a visiting cat that wears exactly that look,
 * the one with the order's name first, so a till that sends no key still never shows the same cat twice. Each cat
 * is given to one order only, the oldest first. Cancelled orders claim nothing.
 * @param {{id: number, status: string, name?: string, look?: object, visitor?: string}[]} orders
 * @param {{key: string, name: string, look: object}[]} visitors
 * @returns {Map<number, string>}
 */
export function claimVisitors(orders, visitors) {
  const out = new Map();
  const free = new Map((visitors ?? []).map((v) => [v.key, v]));
  const live = (orders ?? []).filter((o) => o.status !== "cancelled").sort((a, b) => a.id - b.id);
  for (const o of live) {
    if (typeof o.visitor === "string" && free.has(o.visitor)) { out.set(o.id, o.visitor); free.delete(o.visitor); }
  }
  for (const o of live) {
    if (out.has(o.id) || !o.look) continue;
    const fits = [...free.values()].filter((v) => sameLook(v.look, o.look));
    const name = String(o.name ?? "").trim().toLowerCase();
    const pick = fits.find((v) => String(v.name ?? "").trim().toLowerCase() === name) ?? fits[0];
    if (pick) { out.set(o.id, pick.key); free.delete(pick.key); }
  }
  return out;
}
