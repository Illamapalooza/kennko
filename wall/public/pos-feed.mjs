const WALL_STATUS = { queued: "queued", preparing: "preparing", serving: "serving", done: "done", voided: "cancelled" };

/**
 * Turn the till's wall feed into the wall's own order sheet. Pure.
 * An order is known on the wall by the number the customer was told at the counter.
 * Returns null when the feed cannot be trusted, so a bad message never blanks the wall.
 * @param {unknown} feed what the till sent
 * @param {number} baristas barista cats behind the counter
 */
export function fromPosFeed(feed, baristas) {
  if (!feed || typeof feed !== "object" || !Array.isArray(feed.orders)) return null;
  if (typeof feed.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(feed.day)) return null;
  const orders = [];
  const taken = new Set();
  const age = (a, b) => (a?.createdAt ?? 0) - (b?.createdAt ?? 0) || (a?.id ?? 0) - (b?.id ?? 0);
  for (const o of [...feed.orders].sort(age)) {
    const status = WALL_STATUS[o?.status];
    if (!status || !Number.isInteger(o.id) || o.id < 1) return null;
    if (!Number.isInteger(o.number) || o.number < 1) return null;
    if (!Number.isFinite(o.createdAt) || !Number.isFinite(o.updatedAt) || !Array.isArray(o.items)) return null;
    const items = o.items.filter((l) => typeof l?.name === "string" && Number.isInteger(l?.qty) && l.qty > 0).map((l) => ({ name: l.name, qty: l.qty }));
    if (items.length === 0) continue;
    const online = o.series === "W";
    let id = online ? 5000 + o.number : o.number;
    while (taken.has(id)) id += 1000;
    taken.add(id);
    orders.push({ id, ...(online ? { label: `W${o.number}` } : {}), name: typeof o.name === "string" ? o.name.slice(0, 16) : "", items, status, createdAt: o.createdAt, updatedAt: o.updatedAt });
  }
  orders.sort((a, b) => a.id - b.id);
  return {
    day: feed.day, seq: orders.reduce((max, o) => Math.max(max, o.id), 0), baristas, orders,
    visitors: cleanVisitors(feed.visitors), checkin: cleanCheckin(feed.checkin),
    tillNow: Number.isFinite(feed.now) ? feed.now : null,
  };
}

const MAX_VISITORS = 12;
const SLOTS = ["hat", "face", "neck", "held"];

function cleanVisitors(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const v of raw) {
    if (out.length >= MAX_VISITORS) break;
    if (!v || typeof v.key !== "string" || v.key === "" || v.key.length > 64) continue;
    if (typeof v.name !== "string" || !Number.isFinite(v.endsAt)) continue;
    if (!v.look || typeof v.look.coat !== "string") continue;
    const look = { coat: v.look.coat };
    for (const slot of SLOTS) if (typeof v.look[slot] === "string") look[slot] = v.look[slot];
    out.push({ key: v.key, name: [...v.name].slice(0, 16).join(""), look, endsAt: v.endsAt });
  }
  return out;
}

function cleanCheckin(raw) {
  if (!raw || typeof raw.url !== "string" || !raw.url.startsWith("https://")) return null;
  const rows = raw.modules;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 177) return null;
  if (!rows.every((r) => typeof r === "string" && r.length === rows.length && /^[01]+$/.test(r))) return null;
  return { url: raw.url, modules: [...rows] };
}

/** Feed it text as it arrives; it calls onData once per complete server-sent event. */
export function sseParser(onData) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    let cut;
    while ((cut = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, "");
      const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (data) onData(data);
    }
  };
}

export function agedVisit(visit, receivedAt, now) {
  return { ...visit, tillNow: Number.isFinite(visit.tillNow) ? visit.tillNow + Math.max(0, now - receivedAt) : null };
}
