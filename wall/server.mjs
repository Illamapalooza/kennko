#!/usr/bin/env node
// Kennko wall: serves the cat cafe scene for the shop projector.
// Default (ambient): the cafe runs itself as pure visuals. With --pos the Kennko till drives the cats with real
// orders. With --orders the counter tablet's order pad drives it instead.
// Plain Node, no dependencies. Usage: node server.mjs [--pos [url]] [--no-board] [--orders] [--no-open] [--port N]
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { reduce, emptyState, manilaDay, normalize, OrderError } from "./store.mjs";
import { trackTitle } from "./public/scene/logic.mjs";
import { followPos, fromPosFeed } from "./pos-link.mjs";
import { FALLBACK_DRINKS, readMenu, loadCachedMenu, saveCachedMenu, namesOf, fetchTillMenu } from "./menu-source.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const MUSIC = path.join(ROOT, "music");
const DATA = path.join(ROOT, "data");
const ORDERS_FILE = path.join(DATA, "orders.json");

const args = process.argv.slice(2);
const posArg = args.indexOf("--pos");
const posUrlArg = posArg >= 0 && args[posArg + 1] && !args[posArg + 1].startsWith("--") ? args[posArg + 1] : "";
// Following the till replaces the order pad: orders have one source, never two.
const POS = posArg >= 0;
// "Ambient" means no pad and nothing saved here: either the cafe runs itself, or the till owns the orders.
const AMBIENT = POS || !args.includes("--orders");
// Following the till shows the order board (queue, now preparing, now serving, the ready call) unless told not to.
const BOARD = POS && !args.includes("--no-board");
// What the wall page is told: numbers and the board show whenever real orders are on screen.
const VISUALS_ONLY = AMBIENT && !BOARD;
const NO_OPEN = args.includes("--no-open");
const portArg = args.indexOf("--port");

const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch (err) {
    if (err.code !== "ENOENT") console.warn(`Could not read ${path.basename(file)} (${err.message}); using defaults.`);
    return fallback;
  }
};
const rawConfig = readJson(path.join(ROOT, "config.json"), {});
const num = (v, fallback, min, max) => (Number.isFinite(v) && v >= min && v <= max ? v : fallback);
const config = {
  port: num(portArg >= 0 ? Number(args[portArg + 1]) : rawConfig.port, 4455, 1, 65535),
  pin: typeof rawConfig.pin === "string" ? rawConfig.pin : "",
  volume: num(rawConfig.volume, 0.5, 0, 1),
  autoclearMs: num(rawConfig.autoclearMinutes, 10, 0.1, 600) * 60000,
  boardSize: Math.round(num(rawConfig.boardSize, 5, 1, 10)),
  baristas: Math.round(num(rawConfig.baristas, 2, 1, 3)),
};
const POS_URL = POS ? posUrlArg || (typeof rawConfig.posUrl === "string" && rawConfig.posUrl) || "http://localhost:4466" : "";
// Drink names come from the till and are remembered here; the wall has no menu of its own.
const MENU_FILE = path.join(DATA, "menu.json");
let menu = loadCachedMenu(MENU_FILE) ?? [];
// One Set for good: reduceOpts holds it, so it is updated in place.
const menuNames = namesOf(menu);
if (menuNames.size === 0) console.warn("No drink names yet: they come from the till.");
// An empty menu (a till mid-restart, a blank feed) never replaces the names the wall already has.
function setMenu(next) {
  if (!next || next.length === 0) return;
  const changed = JSON.stringify(next) !== JSON.stringify(menu);
  menu = next;
  menuNames.clear();
  for (const name of namesOf(next)) menuNames.add(name);
  if (changed) saveCachedMenu(MENU_FILE, next);
}
const reduceOpts = { autoclearMs: config.autoclearMs, menuNames };

// ---------- state ----------
function loadState() {
  const today = manilaDay(Date.now());
  if (AMBIENT) return emptyState(today, config.baristas);
  let text;
  try { text = fs.readFileSync(ORDERS_FILE, "utf8"); } catch { return emptyState(today, 1); }
  let state = null;
  try { state = normalize(JSON.parse(text)); } catch { /* handled below */ }
  if (!state) {
    const aside = path.join(DATA, `orders.unreadable-${Date.now()}.json`);
    try { fs.renameSync(ORDERS_FILE, aside); } catch { /* leave it */ }
    console.warn(`The saved orders file could not be read. It was set aside as ${path.basename(aside)}; starting an empty day.`);
    return emptyState(today, 1);
  }
  return reduce(state, { type: "tick" }, Date.now(), reduceOpts);
}

let state = loadState();
let saveFailed = false;

function save() {
  if (AMBIENT) return;
  try {
    fs.mkdirSync(DATA, { recursive: true });
    const tmp = `${ORDERS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, ORDERS_FILE);
    saveFailed = false;
  } catch (err) {
    if (!saveFailed) console.error(`Could not save orders (${err.message}). The wall keeps running, but a restart would lose today's orders.`);
    saveFailed = true;
  }
}

const clients = new Set();
// What the till sent besides orders: visiting cats, the check-in QR and the till's clock. Never saved to disk.
let visit = { visitors: [], checkin: null, tillNow: null };
const snapshot = () => JSON.stringify({ state, now: Date.now(), visit });
function broadcast() {
  const frame = `data: ${snapshot()}\n\n`;
  for (const res of clients) res.write(frame);
}

/** Apply an action; throws OrderError for a bad one. Saves and broadcasts only on change. */
function dispatch(action) {
  const next = reduce(state, action, Date.now(), reduceOpts);
  if (next !== state) {
    state = next;
    save();
    broadcast();
  }
  return state;
}

// While the till is feeding the wall, the till's word is final: no local clean-up of its orders.
let posLive = false;
// The made-up cafe runs when nothing real is driving the wall: always in plain ambient mode, and as a stand-in
// whenever the till cannot be reached, so the wall never sits empty because of a network hiccup.
let selfRunning = AMBIENT && !POS;
setInterval(() => { if (posLive) return; try { dispatch({ type: "tick" }); } catch (err) { console.error(err); } }, 15000).unref();
setInterval(() => { for (const res of clients) res.write(": keepalive\n\n"); }, 20000).unref();

// ---------- ambient: the cafe runs itself ----------
if (AMBIENT) {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const between = (a, b) => a + Math.random() * (b - a);
  const pace = new Map(); // order id -> how long this cat lingers in each state (ms)
  const paceOf = (id) => {
    if (!pace.has(id)) pace.set(id, { queued: between(4000, 12000), preparing: between(11000, 22000), serving: between(30000, 70000) });
    return pace.get(id);
  };
  let nextArrival = Date.now() + 1500;
  setInterval(() => {
    try {
      if (!selfRunning) return;
      const now = Date.now();
      // a made-up order that finished a minute ago is forgotten, so an all-day run stays small
      if (state.orders.some((o) => o.status === "done" && now - o.updatedAt > 60000)) {
        state = { ...state, orders: state.orders.filter((o) => o.status !== "done" || now - o.updatedAt <= 60000) };
      }
      const live = state.orders.filter((o) => o.status !== "done" && o.status !== "cancelled");
      for (const id of pace.keys()) if (!live.some((o) => o.id === id)) pace.delete(id);
      const due = live.filter((o) => now - o.updatedAt > paceOf(o.id)[o.status]).sort((a, b) => a.updatedAt - b.updatedAt);
      const busy = live.filter((o) => o.status === "preparing").length;
      const move = due.find((o) => o.status !== "queued" || busy < state.baristas);
      if (move) return dispatch({ type: "advance", id: move.id });
      const drinks = menuNames.size ? [...menuNames] : FALLBACK_DRINKS;
      if (live.length < 10 && now > nextArrival) {
        const items = [{ name: pick(drinks), qty: 1 }];
        if (Math.random() < 0.3) items.push({ name: pick(drinks), qty: 1 });
        dispatch({ type: "create", items });
        nextArrival = now + between(5000, live.length < 4 ? 9000 : 20000);
      }
    } catch (err) { console.error("ambient:", err.message); }
  }, 1500).unref();
}

// ---------- following the till ----------
if (POS) {
  let downSince = 0;
  let standIn = null;
  followPos(POS_URL, {
    onUp: () => {
      clearTimeout(standIn);
      if (downSince) console.log("  The till is back. The cats are following real orders again.");
      downSince = 0;
    },
    onFeed: (feed) => {
      setMenu(readMenu(feed?.menu));
      const next = fromPosFeed(feed, config.baristas);
      if (!next) return;
      posLive = true;
      selfRunning = false;
      const { visitors, checkin, tillNow, ...sheet } = next;
      state = sheet;
      visit = { visitors, checkin, tillNow };
      broadcast();
    },
    onDown: (why) => {
      posLive = false;
      // the QR's code changes every minute and expires after two, so a stale one only misleads; visiting cats stay until their end time
      if (visit.checkin) { visit = { ...visit, checkin: null }; broadcast(); }
      if (downSince) return;
      downSince = Date.now();
      console.log(`  Can't reach the till at ${POS_URL} (${why}). Still trying; ${BOARD ? "the wall keeps the last orders it saw" : "the cafe will run itself meanwhile"}.`);
      // With the board up, made-up orders would put numbers on the wall that no customer holds, so the wall
      // just keeps the last real orders. Without the board, the cafe runs itself until the till is back.
      if (BOARD) return;
      // A short blip should not swap real orders for made-up ones, so wait a little before standing in.
      standIn = setTimeout(() => { if (!posLive) selfRunning = true; }, 15000);
      standIn.unref();
    },
  });
}

// ---------- asking the till for the menu (when not following its feed) ----------
if (!POS) {
  const tillUrl = posUrlArg || (typeof rawConfig.posUrl === "string" && rawConfig.posUrl) || "http://localhost:4466";
  const refresh = () => fetchTillMenu(tillUrl).then(setMenu, () => {});
  refresh();
  setInterval(refresh, 10 * 60000).unref();
}

// ---------- http ----------
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".oga": "audio/ogg",
  ".opus": "audio/ogg", ".wav": "audio/wav", ".flac": "audio/flac",
};
const AUDIO = new Set([".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav", ".flac"]);

const json = (res, code, body) => {
  res.writeHead(code, { "content-type": MIME[".json"], "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

/** Resolve a URL path inside `base`, or null if it escapes it. */
function inside(base, rel) {
  let decoded;
  try { decoded = decodeURIComponent(rel); } catch { return null; }
  if (decoded.includes("\0")) return null;
  const full = path.resolve(base, `.${path.sep}${decoded}`);
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

function sendFile(req, res, file) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
    const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    const headers = { "content-type": type, "cache-control": "no-cache", "accept-ranges": "bytes" };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    let start = 0, end = stat.size - 1, code = 200;
    if (range && (range[1] || range[2])) {
      if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
      else start = Math.max(0, stat.size - Number(range[2]));
      if (start > end || start >= stat.size) {
        res.writeHead(416, { "content-range": `bytes */${stat.size}` });
        return res.end();
      }
      code = 206;
      headers["content-range"] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers["content-length"] = stat.size === 0 ? 0 : end - start + 1;
    res.writeHead(code, headers);
    if (req.method === "HEAD" || stat.size === 0) return res.end();
    fs.createReadStream(file, { start, end }).on("error", () => res.destroy()).pipe(res);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 16384) { reject(new OrderError("Request too large.")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject(new OrderError("Bad request.")); }
    });
    req.on("error", reject);
  });
}

// A 4-digit PIN is guessable, so wrong guesses lock that device out for a while.
const strikes = new Map();
const MAX_STRIKES = 8;
const LOCK_MS = 5 * 60000;
function pinCheck(req, pin) {
  if (!config.pin) return { ok: true };
  const ip = req.socket.remoteAddress ?? "?";
  const s = strikes.get(ip);
  if (s && s.until > Date.now()) return { ok: false, locked: true };
  if (typeof pin === "string" && pin === config.pin) { strikes.delete(ip); return { ok: true }; }
  const count = (s && s.until === 0 ? s.count : 0) + 1;
  strikes.set(ip, count >= MAX_STRIKES ? { count: 0, until: Date.now() + LOCK_MS } : { count, until: 0 });
  return { ok: false, locked: false };
}
const refuse = (res, check) => json(res, check.locked ? 429 : 401, {
  error: check.locked ? "Too many wrong PINs. Try again in 5 minutes." : "Wrong PIN.",
});

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
}

function playlist() {
  try {
    return fs.readdirSync(MUSIC).filter((f) => !f.startsWith(".") && AUDIO.has(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b)).map((file) => ({ url: `/music/${encodeURIComponent(file)}`, title: trackTitle(file) }));
  } catch { return []; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const route = url.pathname;
  try {
    if (req.method === "GET" || req.method === "HEAD") {
      if (route === "/api/bootstrap") {
        return json(res, 200, {
          menu, ambient: VISUALS_ONLY, pos: POS, volume: config.volume, boardSize: config.boardSize, pinRequired: Boolean(config.pin),
          padUrls: AMBIENT ? [] : lanAddresses().map((a) => `http://${a}:${config.port}/pad`),
        });
      }
      if (route === "/api/playlist") return json(res, 200, playlist());
      if (route === "/api/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(`retry: 2000\n\ndata: ${snapshot()}\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (route.startsWith("/api/")) return json(res, 404, { error: "Not found." });
      if (route.startsWith("/music/")) {
        const file = inside(MUSIC, route.slice("/music/".length));
        if (!file || !AUDIO.has(path.extname(file).toLowerCase())) { res.writeHead(404); return res.end(); }
        return sendFile(req, res, file);
      }
      if (AMBIENT && (route === "/pad" || route.startsWith("/pad."))) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("The order pad is off. Start the wall with --orders to use it."); }
      const rel = route === "/" ? "index.html" : route === "/pad" ? "pad.html" : route.slice(1);
      const file = inside(PUBLIC, rel);
      if (!file) { res.writeHead(404); return res.end(); }
      return sendFile(req, res, file);
    }
    if (req.method === "POST" && AMBIENT) return json(res, 404, { error: "The order pad is off. Start the wall with --orders to use it." });
    if (req.method === "POST" && route === "/api/pin") {
      const body = await readBody(req);
      const check = pinCheck(req, body.pin);
      return check.ok ? json(res, 200, { ok: true }) : refuse(res, check);
    }
    if (req.method === "POST" && route === "/api/action") {
      const check = pinCheck(req, req.headers["x-pin"]);
      if (!check.ok) return refuse(res, check);
      const action = await readBody(req);
      const before = state.seq;
      const next = dispatch(action);
      return json(res, 200, { ok: true, created: next.seq > before && action.type === "create" ? next.seq : null });
    }
    res.writeHead(405, { "content-type": "text/plain" });
    res.end("Method not allowed");
  } catch (err) {
    if (err instanceof OrderError) return json(res, 400, { error: err.message });
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: "Something went wrong on the wall computer." });
    else res.destroy();
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${config.port} is already in use. The wall may already be running; otherwise start with --port <number>.`);
  } else console.error(err.message);
  process.exit(1);
});

server.listen(config.port, "0.0.0.0", () => {
  const wall = `http://localhost:${config.port}/`;
  const pads = lanAddresses().map((a) => `http://${a}:${config.port}/pad`);
  console.log(`\n  KENNKO WALL  (${POS ? `following the till: real orders drive the cats${BOARD ? " and the order board" : ""}` : AMBIENT ? "visuals only: the cafe runs itself" : "orders mode: the tablet drives the cafe"})`);
  if (POS) console.log(`  Till:                  ${POS_URL}`);
  console.log(`  Wall (this computer):  ${wall}`);
  if (!AMBIENT) console.log(pads.length ? `  Order pad (tablet):    ${pads.join("   ")}` : "  Order pad: no network found. On this computer use http://localhost:" + config.port + "/pad");
  if (!AMBIENT && config.pin) console.log(`  Pad PIN:               ${config.pin}   (change it in config.json)`);
  if (playlist().length === 0) console.log("  Music: the music/ folder is empty, so the wall will be silent.");
  console.log("  Press Ctrl+C to stop.\n");
  if (!NO_OPEN) {
    const [cmd, cmdArgs] = process.platform === "darwin" ? ["open", [wall]]
      : process.platform === "win32" ? ["cmd", ["/c", "start", "", wall]] : ["xdg-open", [wall]];
    try { spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch { /* open it by hand */ }
  }
});
