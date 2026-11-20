// Where the wall's drink names come from: the till's published menu, remembered in data/menu.json.
// Plain Node, no dependencies. The menu here is names and a star only; it never carries a price.
import fs from "node:fs";
import path from "node:path";

/** Used by the self-running cafe when the wall has never reached a till. */
export const FALLBACK_DRINKS = ["Latte", "Americano", "Mocha", "Caramel Macchiato"];

const MAX_CATEGORIES = 30;
const MAX_ITEMS = 200;
const MAX_NAME = 40;

/**
 * Check something that claims to be the till's wall menu: `{ category, items: { name, star }[] }[]`.
 * Returns a clean copy (only those fields, names cut to 40), or null when it is not that shape.
 * @param {unknown} x
 */
export function readMenu(x) {
  if (!Array.isArray(x) || x.length > MAX_CATEGORIES) return null;
  let total = 0;
  const menu = [];
  for (const c of x) {
    if (!c || typeof c.category !== "string" || !Array.isArray(c.items)) return null;
    const items = [];
    for (const i of c.items) {
      if (!i || typeof i.name !== "string" || i.name.trim() === "" || typeof i.star !== "boolean") return null;
      if (++total > MAX_ITEMS) return null;
      items.push({ name: i.name.slice(0, MAX_NAME), star: i.star });
    }
    menu.push({ category: c.category.slice(0, MAX_NAME), items });
  }
  return menu;
}

/** The menu saved last time, or null when there is none or it cannot be read. Never throws. */
export function loadCachedMenu(file) {
  try { return readMenu(JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""))); } catch { return null; }
}

/** Save atomically (.tmp then rename). Never throws: a wall that cannot save still runs. */
export function saveCachedMenu(file, menu) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(menu));
    fs.renameSync(tmp, file);
  } catch { /* the cache is a convenience */ }
}

export const namesOf = (menu) => new Set(menu.flatMap((c) => c.items.map((i) => i.name)));

/** Ask a till for its menu. Null when it cannot be reached, is too slow or answers with anything else. */
export async function fetchTillMenu(baseUrl, timeoutMs = 3000) {
  try {
    const res = await fetch(new URL("/api/wall/menu", baseUrl), { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = await res.json();
    return readMenu(body?.menu);
  } catch { return null; }
}
