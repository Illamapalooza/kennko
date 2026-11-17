// Lets the wall follow the Kennko POS: real orders from the till drive the cats.
// Plain Node, no dependencies, like the rest of the wall.

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
  // Oldest first, so if yesterday's last order is still open after midnight it keeps its number.
  for (const o of [...feed.orders].sort((a, b) => (a?.id ?? 0) - (b?.id ?? 0))) {
    const status = WALL_STATUS[o?.status];
    if (!status || !Number.isInteger(o.id) || o.id < 1) return null;
    if (!Number.isInteger(o.number) || o.number < 1) return null;
    if (!Number.isFinite(o.createdAt) || !Number.isFinite(o.updatedAt) || !Array.isArray(o.items)) return null;
    const items = o.items.filter((l) => typeof l?.name === "string" && Number.isInteger(l?.qty) && l.qty > 0).map((l) => ({ name: l.name, qty: l.qty }));
    if (items.length === 0) continue;
    // Numbers restart each day, so two open orders can share one across midnight; the newer one is moved aside.
    let id = o.number;
    while (taken.has(id)) id += 1000;
    taken.add(id);
    orders.push({ id, name: typeof o.name === "string" ? o.name.slice(0, 16) : "", items, status, createdAt: o.createdAt, updatedAt: o.updatedAt });
  }
  orders.sort((a, b) => a.id - b.id);
  return { day: feed.day, seq: orders.reduce((max, o) => Math.max(max, o.id), 0), baristas, orders };
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

/**
 * Keep a connection to the till open for as long as the wall runs, reconnecting whenever it drops.
 * @param {string} baseUrl e.g. http://localhost:4466
 * @param {{ onFeed: (feed: unknown) => void, onUp: () => void, onDown: (why: string) => void }} handlers
 */
export function followPos(baseUrl, { onFeed, onUp, onDown }) {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/wall/events`;
  let stopped = false;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  (async () => {
    while (!stopped) {
      const abort = new AbortController();
      // The till sends a keepalive every 20s; a longer silence means the line is dead even if the socket is not.
      let quiet = setTimeout(() => abort.abort(), 45000);
      try {
        const res = await fetch(url, { headers: { accept: "text/event-stream" }, signal: abort.signal });
        if (!res.ok || !res.body) throw new Error(`the till answered ${res.status}`);
        onUp();
        const parse = sseParser((data) => {
          try { onFeed(JSON.parse(data)); } catch { /* a garbled message is skipped; the next one replaces it */ }
        });
        const decoder = new TextDecoder();
        for await (const chunk of res.body) {
          clearTimeout(quiet);
          quiet = setTimeout(() => abort.abort(), 45000);
          parse(decoder.decode(chunk, { stream: true }));
        }
        throw new Error("the till closed the connection");
      } catch (err) {
        if (!stopped) onDown(err?.cause?.code === "ECONNREFUSED" ? "the till is not running" : err?.name === "AbortError" ? "the till went quiet" : err?.message === "terminated" ? "the till stopped" : String(err?.message ?? err));
      } finally {
        clearTimeout(quiet);
      }
      await wait(3000);
    }
  })();

  return () => { stopped = true; };
}
