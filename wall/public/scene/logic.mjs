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

/** What the board shows: each state's oldest `cap` orders and how many more are hidden. */
export function boardView(orders, cap) {
  const column = (status, limit) => {
    const all = orders.filter((o) => o.status === status).sort(status === "queued" ? (a, b) => a.id - b.id : byAge);
    return { shown: all.slice(0, limit), more: Math.max(0, all.length - limit) };
  };
  return { queued: column("queued", cap * 2), preparing: column("preparing", cap), serving: column("serving", cap) };
}

/** "03 - lofi_morning.mp3" -> "lofi morning" */
export function trackTitle(file) {
  const base = String(file).replace(/\.[a-z0-9]{2,5}$/i, "").replace(/_/g, " ");
  const stripped = base.replace(/^\s*\d{1,3}\s*[-.)]?\s+/, "").trim();
  return stripped || base.trim() || String(file);
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

// The tables, listed in the order they fill. Positions are a cat's feet: centre x, bottom y.
export const TABLES = [{ x: 172, y: 142 }, { x: 60, y: 142 }, { x: 214, y: 112 }, { x: 258, y: 142 }, { x: 112, y: 142 }, { x: 214, y: 142 }, { x: 258, y: 112 }];
export const SEAT_SPOTS = TABLES.flatMap((t) => [{ x: t.x - 15, y: t.y }, { x: t.x + 15, y: t.y }]);

/**
 * Where visiting cats stand: the free floor below the counter and between the tables, in two staggered rows
 * (so their name tags do not collide) and a short row on the right. None is on the counter or near a seat.
 */
export const VISIT_SPOTS = [
  ...[24, 66, 108, 150].map((x) => ({ x, y: 112, flip: x > 100 })),
  ...[26, 62, 98, 134, 170].map((x) => ({ x, y: 125, flip: x > 100 })),
  ...[196, 232, 268].map((x) => ({ x, y: 124, flip: true })),
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
