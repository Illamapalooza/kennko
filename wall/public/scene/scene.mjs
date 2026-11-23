// The cat cafe: a 288 x 152 pixel room drawn on a canvas, with crisp DOM labels laid over it.
// Table service: customers sit down, a barista makes the drink, a server cat carries it over.
import { drawCat, drawLoaf, drawCup, drawText, textWidth, catBounds, COAT_COLOURS, CAT_W, CAT_H, INK, BLUE, AMBER } from "./sprites.mjs";
import { coatFor, assignBaristas, assignSlots, claimVisitors, itemsLabel, TABLES, VISIT_SPOTS, visitorView } from "./logic.mjs";

export const W = 288;
export const H = 152;

// Positions are a cat's feet: centre x, bottom y.
const WAIT = [26, 48, 70, 92, 114, 136].map((x) => ({ x, y: 122 })); // standing room, only when every seat is taken
// listed in the order they fill, so the room looks evenly busy
const SEATS = TABLES.flatMap((t) => [{ x: t.x - 15, y: t.y, flip: false, table: t }, { x: t.x + 15, y: t.y, flip: true, table: t }]);
const DOOR = { x: 298, y: 122 };
const STATIONS = [62, 104, 132];
const BARISTA_TOP = 63;
const BARISTA_COATS = ["tuxedo", "ginger", "tabby"];
const TRAY = { x: 160, y: 116 }; // where the server collects drinks
const SERVER_HOME = { x: 176, y: 102 };
const WALK = 30; // px per second
const MAX_TICKETS = 6;
const RAIL_END = 154; // the ticket rail runs from x 58 to here

const rand = (a, b) => a + Math.random() * (b - a);

function paintRoom(g) {
  const R = (c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const IN_W = 182;
  // indoor walls: charcoal-slate left wall (0..33), deep Kennko blue counter wall (34..181)
  R("#2c3242", 0, 0, 34, 64);
  R("#0d2c7a", 34, 0, IN_W - 34, 64);
  // red/terracotta tile backsplash & storefront header trim
  R("#9c332b", 34, 44, IN_W - 34, 20);
  for (let y = 44; y < 64; y += 4) R("#7c241d", 34, y, IN_W - 34, 1);
  for (let x = 36; x < IN_W; x += 4) R("#7c241d", x, 44, 1, 20);
  R("#9c332b", 148, 2, 34, 6);
  for (let x = 150; x < IN_W; x += 4) R("#7c241d", x, 2, 1, 6);
  R("#1e2433", 0, 63, IN_W, 1);
  // 3 posters on the charcoal left wall (quote, sausage dogs, vinyl)
  R(INK, 6, 12, 7, 9); R("#d9432b", 7, 13, 5, 7); R("#ffd8c8", 8, 15, 3, 1); R("#ffd8c8", 8, 17, 3, 1);
  R(INK, 15, 12, 7, 9); R("#f7f2ea", 16, 13, 5, 7); R("#a86a44", 17, 15, 3, 1); R("#a86a44", 17, 18, 3, 1);
  R(INK, 24, 12, 7, 9); R("#e8523f", 25, 13, 5, 7); R(INK, 26, 14, 3, 3);
  // vertical warm corner floor lamp (left)
  R("#fff3c4", 2, 34, 2, 28); R("#ffd27d", 1, 34, 1, 28);
  // white fridge with black-cat portrait on left
  R(INK, 10, 26, 16, 37); R("#eef2f8", 11, 27, 14, 35); R("#d0d8e8", 11, 44, 14, 1);
  R(INK, 13, 30, 8, 8); R("#d9432b", 14, 31, 6, 6); R(INK, 15, 33, 4, 4);
  // cream-marble indoor floor (0..181) and al fresco grassy camp floor (184..288)
  for (let y = 64, row = 0; y < H; y += 12, row++) {
    for (let x = 0, col = 0; x < IN_W; x += 12, col++) R((row + col) % 2 ? "#ebe5dc" : "#e1dad0", x, y, Math.min(12, IN_W - x), 12);
  }
  R("#79c46b", 184, 64, 104, 88);
  // grassy texture patches, tufts, and tiny camp wildflowers
  for (let y = 68, row = 0; y < H; y += 10, row++) {
    for (let x = 188, col = 0; x < W - 4; x += 14, col++) {
      const gx = x + ((row * 5 + col * 3) % 6);
      R((row + col) % 2 ? "#87d178" : "#6bb55d", gx, y, 4, 2);
      R("#599e4c", gx + 1, y - 1, 1, 1);
      R("#599e4c", gx + 3, y - 1, 1, 1);
      if ((row + col) % 5 === 0) R("#fff5b8", gx + 6, y + 3, 2, 2);
      else if ((row * 3 + col) % 7 === 0) R("#ffffff", gx + 5, y + 4, 1, 1);
    }
  }
  // wooden stepping planks at the glass door into the grass camp
  R("#b3834c", 184, 114, 6, 18); R("#cfa067", 184, 115, 5, 4); R("#cfa067", 184, 121, 5, 4); R("#cfa067", 184, 127, 5, 4);
  R("#cbc3b8", 12, 64, 166, 12);
  // glass storefront doorway divider with frosted stripes
  R(INK, 181, 0, 3, 64); R("#9fc3f5", 182, 2, 1, 60);
  R("#1e2433", 181, 64, 3, 88); R("#d8e4f5", 182, 66, 1, 84);
  R("#ffffff", 181, 108, 3, 3); R("#ffffff", 181, 114, 3, 3);
  // 3 black hanging pendant lamps over the counter
  for (const x of [66, 102, 136]) {
    R(INK, x, 0, 1, 7); R("#1a1e2b", x - 2, 7, 5, 4); R("#fff3c4", x - 1, 11, 3, 1);
  }
  // convex safety mirror in corner above glass door
  R("#d9432b", 142, 4, 7, 7); R("#9bb6db", 143, 5, 5, 5); R("#ffffff", 144, 6, 2, 1);
  // menu board on the blue back wall
  R(INK, 30, 10, 32, 30); R("#162344", 31, 11, 30, 28);
  drawText(g, "MENU", 46 - Math.floor(textWidth("MENU") / 2), 14, "#ffffff");
  for (let i = 0; i < 4; i++) { R("#9db6ee", 34, 22 + i * 4, 15, 1); R(AMBER, 53, 22 + i * 4, 4, 1); }
  // ticket rail
  R(INK, 64, 28, 80, 1);
  // plush pure-red velvet sofa with rounded armrests, seat crease, legs & throw pillows behind In 3
  R(INK, 139, 112, 32, 1); R(INK, 137, 113, 36, 13); R(INK, 135, 117, 40, 10); // silhouette
  R("#b8252d", 138, 113, 34, 9); R("#d1363e", 140, 113, 30, 2); // rounded backrest
  R("#941b22", 136, 117, 4, 9); R("#b8252d", 137, 117, 2, 3); // left rounded armrest
  R("#941b22", 170, 117, 4, 9); R("#b8252d", 171, 117, 2, 3); // right rounded armrest
  R("#7a141a", 140, 121, 30, 1); // backrest-to-seat crease
  R("#c9323b", 140, 122, 30, 3); // seat cushion
  R("#8a1820", 136, 125, 38, 2); // front skirt
  R(INK, 137, 127, 36, 1); R(INK, 138, 128, 2, 2); R(INK, 170, 128, 2, 2); // sofa legs
  // soft throw pillows (tucked at corners, not stiff squares)
  R("#f2e6d5", 141, 117, 4, 4); R("#dfd0bc", 141, 120, 4, 1);
  R("#ffffff", 162, 117, 4, 4); R("#e2e8f5", 162, 120, 4, 1);
  R("#e8b85d", 165, 118, 4, 3); R("#c99438", 165, 120, 4, 1);
  // indoor window frame and sill (the sky is painted live, matching the outdoor camp sky)
  R(INK, 150, 9, 30, 27); R("#ffffff", 148, 34, 34, 3); R(INK, 148, 37, 34, 1);
  // striped cafe awning peeking outside the storefront doorway
  for (let i = 0; i < 6; i++) R(i % 2 ? "#ffffff" : "#1c2b4f", 184 + i * 4, 48, 4, 5);
  R(INK, 184, 53, 24, 1);
  // al fresco wooden camp fence, string-light poles, and leafy bushes (the sky above y=53 is painted live)
  R(INK, 184, 5, 3, 59); R("#9c6635", 185, 6, 1, 58);
  R(INK, 285, 5, 3, 59); R("#9c6635", 286, 6, 1, 58);
  R("#257344", 189, 50, 18, 13); R("#349658", 192, 47, 12, 10); R("#43b36b", 195, 49, 6, 5);
  R("#257344", 267, 49, 17, 14); R("#349658", 270, 46, 11, 11); R("#43b36b", 273, 48, 5, 5);
  R(INK, 184, 55, 104, 5); R("#b37943", 184, 56, 104, 3);
  R(INK, 184, 62, 104, 2); R("#61a654", 184, 63, 104, 1);
  for (const x of [198, 218, 238, 258, 276]) { R(INK, x, 53, 4, 11); R("#9c6635", x + 1, 54, 2, 9); }
  // welcome mat at the glass storefront door (al fresco side)
  R(AMBER, 174, 114, 7, 18); R("#e09a1c", 174, 114, 7, 1); R("#e09a1c", 174, 131, 7, 1);
}

function paintCounter(g) {
  const R = (c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  R(INK, 26, 75, 152, 27);
  // warm wood countertop + subtle LED under-glow
  R("#b37943", 27, 76, 150, 4); R("#8a572a", 27, 80, 150, 1);
  R("#9ec2ff", 27, 81, 150, 1);
  R(BLUE, 27, 82, 150, 17); R("#0041c4", 27, 99, 150, 2);
  for (const x of [52, 76, 126, 150]) R("#0047d9", x, 84, 1, 13);
  // espresso machine
  R(INK, 34, 57, 29, 20); R("#2a3040", 35, 58, 27, 18); R("#40485e", 35, 58, 27, 3); R(BLUE, 35, 63, 27, 2);
  R(INK, 40, 67, 5, 3); R(INK, 51, 67, 5, 3); R("#8d97b3", 37, 74, 23, 2); R(AMBER, 57, 59, 2, 1);
  // the counter tablet
  R(INK, 84, 71, 2, 5); R(INK, 78, 62, 14, 10); R("#7fb0ff", 79, 63, 12, 8); R("#ffffff", 81, 65, 5, 1); R("#ffffff", 81, 67, 8, 1);
  // milk pitcher
  R(INK, 115, 68, 8, 8); R("#e9eefb", 116, 69, 6, 6); R(INK, 123, 70, 2, 4);
  // serving tray
  R(INK, 145, 74, 30, 3); R(AMBER, 146, 74, 28, 2);
}

function skyFor(hour) {
  if (hour >= 6 && hour < 16) return { phase: "day", top: "#7cc4ff", low: "#c6e8ff", stars: false };
  if (hour >= 16 && hour < 18.5) return { phase: "afternoon", top: "#ff9f6b", low: "#ffd98a", stars: false };
  if (hour >= 5 && hour < 6) return { phase: "dawn", top: "#8fa6e8", low: "#ffd0b0", stars: false };
  return { phase: "night", top: "#1e2b5e", low: "#36478c", stars: true };
}

/**
 * @param {HTMLCanvasElement} canvas 288 x 152
 * @param {HTMLElement} tagLayer positioned box exactly over the canvas
 * @param {{manilaHour?: () => number, clock?: () => number}} [opts] clock: now on the till's clock (visitors' end times are on it)
 */
export function createScene(canvas, tagLayer, opts = {}) {
  const ctx = canvas.getContext("2d");
  const room = document.createElement("canvas");
  room.width = W; room.height = H;
  paintRoom(room.getContext("2d"));
  const manilaHour = opts.manilaHour ?? (() => ((Date.now() / 3600000 + 8) % 24));
  const clock = opts.clock ?? Date.now;

  /** @type {Map<number, any>} */ const custs = new Map();
  let orders = [];
  let baristaCount = 1;
  let ambient = false; // ambient: pure visuals, no order numbers anywhere
  let assignment = [];
  let waitSlots = new Map();
  const seatOf = new Map(); // order id -> seat index
  const baristas = [];
  const server = { x: SERVER_HOME.x, y: SERVER_HOME.y, tx: SERVER_HOME.x, ty: SERVER_HOME.y, state: "idle", job: null, carrying: false, flip: true, moving: false };
  const steam = [];
  /** @type {Map<string, any>} visiting cats by their per-visit key */ const visitors = new Map();
  const campCats = [
    { x: 236, y: 88, tx: 236, ty: 88, flip: true, moving: false, seed: 301, look: { coat: "ginger" }, spot: { x: 236, y: 88, flip: true }, nextAct: 1.5 },
    { x: 236, y: 124, tx: 236, ty: 124, flip: false, moving: false, seed: 302, look: { coat: "calico" }, spot: { x: 236, y: 124, flip: false }, nextAct: 2.8 },
    { x: 196, y: 84, tx: 196, ty: 84, flip: false, moving: false, seed: 303, look: { coat: "tabby" }, spot: { x: 196, y: 84, flip: false }, nextAct: 4.1 },
  ];
  let visitSlots = new Map();
  let lastVisitors = []; // the feed's visitors as last given to sync(), claimed ones included
  const tags = new Map();
  let t = 0; // seconds
  let last = performance.now();
  let raf = 0;

  const freeSeat = (tableNum) => {
    const used = new Set(seatOf.values());
    if (tableNum >= 1 && tableNum <= TABLES.length) {
      const base = (tableNum - 1) * 2;
      if (!used.has(base)) return base;
      if (!used.has(base + 1)) return base + 1;
    }
    for (let i = 0; i < SEATS.length; i++) if (!used.has(i)) return i;
    return -1;
  };
  const go = (c, p) => { c.tx = p.x; c.ty = p.y; };
  const isActive = (o) => o.status === "queued" || o.status === "preparing" || o.status === "serving";

  /** Visit keys held by an order's cat right now: those cats are at a seat, not on a visiting spot. */
  const heldKeys = () => new Set([...custs.values()].filter((c) => c.visitorKey).map((c) => c.visitorKey));
  const visitingNow = (key) => lastVisitors.find((v) => v.key === key && Number.isFinite(v.endsAt) && v.endsAt > clock());
  const freeVisitors = () => { const held = heldKeys(); return lastVisitors.filter((v) => !held.has(v.key)); };

  /**
   * An order's cat that is a visiting cat goes back to being a visitor, from where it stands: the same cat walks to
   * a visiting spot. Returns false when the visit is over (or the cat was never a visitor), so it leaves by the door.
   */
  function backToVisiting(c) {
    const info = c.visitorKey ? visitingNow(c.visitorKey) : null;
    if (!info || ambient) return false;
    custs.delete(c.id);
    visitors.set(info.key, { key: info.key, x: c.x, y: c.y, tx: c.x, ty: c.y, flip: c.flip, phase: "in", moving: false, seed: visitors.size + 1, name: info.name, look: info.look, endsAt: info.endsAt });
    syncVisitors(freeVisitors(), false);
    return true;
  }

  function leave(c) {
    seatOf.delete(c.id);
    if (backToVisiting(c)) return;
    c.phase = "leave";
    go(c, DOOR);
  }

  /** Bring the cats in line with the orders. `initial` places them without walking in. */
  function sync(nextOrders, count, initial = false, nextVisitors = []) {
    orders = nextOrders;
    baristaCount = count;
    lastVisitors = nextVisitors ?? [];
    // One cat per customer: an order whose customer's cat is visiting uses that cat, it does not bring a second one.
    // Only an order that still has (or is about to get) a cat can hold one: a finished order whose cat already went
    // back to visiting must not keep the customer's next order from using it.
    const wantsCat = (o) => isActive(o) || custs.has(o.id);
    const claims = ambient ? new Map() : claimVisitors(orders.filter(wantsCat), visitorView(lastVisitors, clock()));
    const preparing = orders.filter((o) => o.status === "preparing").sort((a, b) => a.updatedAt - b.updatedAt || a.id - b.id).map((o) => o.id);
    assignment = assignBaristas(assignment, preparing, count);

    // seats first, oldest order first; whoever is left stands and waits
    const active = orders.filter(isActive).sort((a, b) => a.id - b.id);
    for (const o of active) {
      if (seatOf.has(o.id)) {
        if (o.table >= 1 && o.table <= TABLES.length && Math.floor(seatOf.get(o.id) / 2) + 1 !== o.table) {
          const used = new Set(seatOf.values());
          const base = (o.table - 1) * 2;
          if (!used.has(base)) seatOf.set(o.id, base);
          else if (!used.has(base + 1)) seatOf.set(o.id, base + 1);
        }
        continue;
      }
      const seat = freeSeat(o.table);
      if (seat >= 0) seatOf.set(o.id, seat);
    }
    waitSlots = assignSlots(waitSlots, active.filter((o) => !seatOf.has(o.id)).map((o) => o.id), WAIT.length);

    const seen = new Set();
    for (const o of orders) {
      seen.add(o.id);
      let c = custs.get(o.id);
      const claim = claims.get(o.id) ?? null;
      if (!c && isActive(o)) {
        // The visiting cat itself becomes the order's cat and walks from where it stands; anyone else comes in by the door.
        const walking = claim ? visitors.get(claim) : null;
        c = { id: o.id, coat: o.look ?? walking?.look ?? coatFor(o.id), x: walking?.x ?? DOOR.x, y: walking?.y ?? DOOR.y, tx: DOOR.x, ty: DOOR.y, phase: "in", cup: false, flip: walking?.flip ?? false, leaveAt: 0, snap: initial && !walking, visitorKey: claim };
        if (walking) visitors.delete(claim);
        custs.set(o.id, c);
      } else if (c) {
        if (c.phase !== "leave" && claim !== c.visitorKey) {
          if (claim) {
            // A cat was assigned after the order was placed: the stand-in is replaced by the real cat, which walks over from its spot.
            const walking = visitors.get(claim);
            if (walking) { c.x = walking.x; c.y = walking.y; c.flip = walking.flip; visitors.delete(claim); }
            c.visitorKey = claim;
          } else if (c.visitorKey && isActive(o)) {
            // The cat was taken off the order: it goes back to visiting and a plain cat keeps the seat.
            const info = visitingNow(c.visitorKey);
            if (info) visitors.set(info.key, { key: info.key, x: c.x, y: c.y, tx: c.x, ty: c.y, flip: c.flip, phase: "in", moving: false, seed: visitors.size + 1, name: info.name, look: info.look, endsAt: info.endsAt });
            c.visitorKey = null;
          }
        }
        c.coat = o.look ?? (c.visitorKey ? c.coat : coatFor(o.id));
      }
      if (!c) continue;
      if (isActive(o)) {
        c.phase = "in";
        if (o.status !== "serving") c.cup = false;
        const seat = seatOf.get(o.id);
        const slot = waitSlots.get(o.id);
        go(c, seat !== undefined ? SEATS[seat] : slot >= 0 ? WAIT[slot] : { x: 20 + (o.id % 6) * 17, y: 150 });
      } else if (o.status === "done") {
        const dineIn = o.fulfilment === "dine_in";
        if (dineIn && o.table >= 1 && o.table <= TABLES.length && seatOf.has(o.id) && Math.floor(seatOf.get(o.id) / 2) + 1 !== o.table) {
          const used = new Set(seatOf.values());
          const base = (o.table - 1) * 2;
          const nextSeat = !used.has(base) ? base : !used.has(base + 1) ? base + 1 : -1;
          if (nextSeat >= 0) {
            seatOf.set(o.id, nextSeat);
            go(c, SEATS[nextSeat]);
          }
        }
        if (c.phase === "in") {
          c.cup = true;
          c.phase = "finish";
          c.dineIn = dineIn;
          c.leaveAt = dineIn ? Infinity : t + rand(6, 14);
        } else {
          c.dineIn = dineIn;
        }
      } else if (c.phase !== "leave") {
        c.cup = false;
        leave(c);
      }
      if (c.snap) { c.x = c.tx; c.y = c.ty; c.snap = false; if (o.status === "serving") c.cup = true; }
    }
    for (const c of custs.values()) if (!seen.has(c.id) && c.phase !== "leave") leave(c);

    while (baristas.length < count) {
      const i = baristas.length;
      baristas.push({ x: STATIONS[i], tx: STATIONS[i], nextMove: t + rand(2, 6), coat: BARISTA_COATS[i % BARISTA_COATS.length] });
    }
    baristas.length = Math.min(baristas.length, count);
    // A cat that is at a seat for its order is not also standing on a visiting spot.
    syncVisitors(ambient ? [] : freeVisitors(), initial);
  }

  /** Visiting cats: the ones on the list stand on their spot, a new one walks in, one gone walks out. */
  function syncVisitors(list, initial) {
    const here = visitorView(list, clock());
    visitSlots = assignSlots(visitSlots, here.map((v) => v.key), VISIT_SPOTS.length);
    const seen = new Set();
    for (const info of here) {
      const slot = visitSlots.get(info.key);
      if (slot < 0) continue;
      seen.add(info.key);
      let v = visitors.get(info.key);
      if (!v) {
        v = { key: info.key, x: DOOR.x, y: DOOR.y, tx: DOOR.x, ty: DOOR.y, flip: false, phase: "in", moving: false, seed: visitors.size + 1 };
        visitors.set(info.key, v);
        if (initial) { v.x = VISIT_SPOTS[slot].x; v.y = VISIT_SPOTS[slot].y; v.flip = VISIT_SPOTS[slot].flip; }
      }
      v.name = info.name; v.look = info.look; v.endsAt = info.endsAt; v.phase = "in";
      go(v, VISIT_SPOTS[slot]);
      v.spot = VISIT_SPOTS[slot];
    }
    for (const v of visitors.values()) if (!seen.has(v.key) && v.phase !== "leave") { v.phase = "leave"; go(v, DOOR); }
  }

  /** Move toward the target; returns true once there. */
  function walk(e, dt) {
    const dx = e.tx - e.x, dy = e.ty - e.y;
    const dist = Math.hypot(dx, dy);
    e.moving = dist > 0.5;
    if (!e.moving) { e.x = e.tx; e.y = e.ty; return true; }
    const move = Math.min(dist, WALK * dt);
    e.x += (dx / dist) * move; e.y += (dy / dist) * move;
    if (Math.abs(dx) > 0.5) e.flip = dx < 0;
    return false;
  }

  /** Where the server stands to hand a drink to this customer. */
  function besideOf(c) {
    const seat = SEATS[seatOf.get(c.id)];
    return seat ? { x: seat.table.x, y: seat.table.y + 9 } : { x: c.tx + 13, y: c.ty };
  }

  const sendHome = () => { server.job = null; server.carrying = false; server.state = "return"; go(server, SERVER_HOME); };

  function stepServer(dt) {
    const arrived = walk(server, dt);
    if (server.state === "idle") {
      const next = orders.filter((o) => o.status === "serving").sort((a, b) => a.updatedAt - b.updatedAt)
        .map((o) => custs.get(o.id)).find((c) => c && c.phase === "in" && !c.cup && !c.moving);
      if (next) { server.job = next.id; server.state = "toTray"; go(server, TRAY); }
      return;
    }
    if (server.state === "return") {
      if (arrived) { server.state = "idle"; server.flip = true; }
      return;
    }
    const target = custs.get(server.job);
    if (!target || target.phase !== "in" || target.cup) return sendHome(); // the order was undone, cancelled or finished
    if (server.state === "toTray") {
      if (arrived) { server.carrying = true; server.state = "toCust"; go(server, besideOf(target)); }
      return;
    }
    go(server, besideOf(target));
    if (arrived && !target.moving) { target.cup = true; sendHome(); }
  }

  function pickIdleAction(e, { canWander = false, canNap = false } = {}) {
    const r = Math.random();
    e.actAt = t;
    e.lookFlip = undefined;
    if (canWander && r < 0.25 && e.spot) {
      e.act = "wander";
      e.tx = Math.max(16, Math.min(272, Math.round(e.spot.x + rand(-8, 8))));
      e.ty = Math.max(84, Math.min(149, Math.round(e.spot.y + rand(-4, 4))));
      e.nextAct = t + rand(3, 6);
      return;
    }
    if (canNap && r < 0.4) {
      e.act = "nap";
      e.nextAct = t + rand(4, 7);
      return;
    }
    if (r < 0.58) {
      e.act = "look";
      e.lookFlip = !e.flip;
      e.nextAct = t + rand(1.4, 2.4);
    } else if (r < 0.74) {
      e.act = "hop";
      e.nextAct = t + rand(1.8, 3.2);
    } else if (r < 0.9) {
      e.act = "happy";
      e.nextAct = t + rand(2.2, 4.0);
    } else {
      e.act = "idle";
      e.nextAct = t + rand(2.5, 5.5);
    }
  }

  function step(dt) {
    for (const c of custs.values()) {
      if (!walk(c, dt)) { c.act = "idle"; continue; }
      const seat = SEATS[seatOf.get(c.id)];
      if (seat && c.phase !== "leave") c.flip = seat.flip;
      if (c.phase === "finish" && !c.dineIn && t > c.leaveAt) leave(c);
      else if (c.phase === "leave") custs.delete(c.id);
      else if ((c.phase === "in" || (c.phase === "finish" && c.dineIn)) && t > (c.nextAct ?? 0)) {
        if (c.nextAct === undefined) c.nextAct = t + rand(1.5, 4.5);
        else pickIdleAction(c, { canWander: !seat && waitSlots.get(c.id) >= 0, canNap: c.phase === "finish" });
      }
    }
    for (const v of visitors.values()) {
      // a visit that ends between two feeds still ends on time, by the till's clock
      if (v.phase === "in" && v.endsAt <= clock()) { v.phase = "leave"; go(v, DOOR); }
      if (!walk(v, dt)) { v.act = "idle"; continue; }
      if (v.phase === "leave") visitors.delete(v.key);
      else {
        if (v.spot && v.act !== "wander" && v.act !== "look") v.flip = v.spot.flip;
        if (t > (v.nextAct ?? 0)) {
          if (v.nextAct === undefined) v.nextAct = t + rand(1.5, 4.5);
          else pickIdleAction(v, { canWander: true, canNap: true });
        }
      }
    }
    for (const n of campCats) {
      if (!walk(n, dt)) { n.act = "idle"; continue; }
      if (n.spot && n.act !== "wander" && n.act !== "look") n.flip = n.spot.flip;
      if (t > n.nextAct) pickIdleAction(n, { canWander: true, canNap: true });
    }
    if (baristaCount > 0) stepServer(dt);
    baristas.forEach((b, i) => {
      const working = assignment[i] != null;
      if (working) b.tx = STATIONS[i];
      else if (t > b.nextMove) { b.tx = STATIONS[i] + Math.round(rand(-9, 9)); b.nextMove = t + rand(3, 8); }
      const dx = b.tx - b.x;
      b.moving = Math.abs(dx) > 0.5;
      if (b.moving) { b.x += Math.sign(dx) * Math.min(Math.abs(dx), 18 * dt); b.flip = dx < 0; } else b.x = b.tx;
      if (working && !b.moving && Math.random() < dt * 5) steam.push({ x: b.x + rand(-3, 6), y: BARISTA_TOP + 5, life: 1 });
    });
    if (assignment.some((id) => id != null) && Math.random() < dt * 6) steam.push({ x: rand(29, 45), y: 57, life: 1 });
    for (let i = steam.length - 1; i >= 0; i--) {
      const p = steam[i];
      p.y -= 9 * dt; p.x += Math.sin((t + i) * 3) * 4 * dt; p.life -= dt * 0.9;
      if (p.life <= 0) steam.splice(i, 1);
    }
    if (steam.length > 60) steam.splice(0, steam.length - 60);
  }

  const blink = (seed) => ((t * 1000 + seed * 733) % 4200) < 140;

  function drawWindow() {
    const sky = skyFor(manilaHour());
    // indoor window sky (x: 152..178, y: 10..34)
    ctx.save();
    ctx.beginPath(); ctx.rect(152, 10, 26, 24); ctx.clip();
    ctx.fillStyle = sky.top; ctx.fillRect(152, 10, 26, 15);
    ctx.fillStyle = sky.low; ctx.fillRect(152, 25, 26, 9);
    if (sky.stars) {
      ctx.fillStyle = "#ffffff";
      for (const [x, y] of [[156, 13], [164, 16], [173, 12], [160, 21]]) {
        if (Math.floor(t * 1.5 + x) % 5) ctx.fillRect(x, y, 1, 1);
      }
      ctx.fillStyle = "#fff3c4"; ctx.fillRect(171, 14, 3, 3);
    } else {
      ctx.fillStyle = "#ffffff";
      for (const [speed, y, w] of [[2.2, 14, 9], [1.4, 21, 7]]) {
        const x = 146 + ((t * speed + y * 5) % 40);
        ctx.fillRect(Math.round(x), y, w, 2); ctx.fillRect(Math.round(x) + 2, y - 1, w - 4, 1);
      }
    }
    ctx.restore();
    ctx.fillStyle = INK; ctx.fillRect(165, 10, 1, 24); ctx.fillRect(152, 21, 26, 1);
    drawLoaf(ctx, 155, 26, "cream", Math.floor(t / 1.6) % 2);
    drawZzz(170, 20);

    // outdoor al fresco sky (x: 184..288, y: 0..53), matching the exact same atmosphere as the window
    ctx.save();
    ctx.beginPath(); ctx.rect(184, 0, 104, 53); ctx.clip();
    ctx.fillStyle = sky.top; ctx.fillRect(184, 0, 104, 33);
    ctx.fillStyle = sky.low; ctx.fillRect(184, 33, 104, 20);
    if (sky.stars) {
      ctx.fillStyle = "#ffffff";
      for (const [x, y] of [[194, 8], [212, 15], [228, 6], [244, 18], [260, 10], [276, 20], [202, 26], [238, 29], [268, 32]]) {
        if (Math.floor(t * 1.5 + x) % 5) ctx.fillRect(x, y, 1, 1);
      }
      ctx.fillStyle = "#fff3c4"; ctx.fillRect(264, 10, 6, 6);
    } else {
      ctx.fillStyle = "#ffffff";
      for (const [speed, y, w] of [[2.2, 11, 16], [1.4, 23, 12], [1.8, 34, 14]]) {
        const x = 176 + ((t * speed + y * 7) % 124);
        ctx.fillRect(Math.round(x), y, w, 3); ctx.fillRect(Math.round(x) + 3, y - 2, w - 6, 2);
      }
    }
    // festoon patio string lights
    ctx.fillStyle = INK;
    for (let px = 184; px < 288; px += 2) {
      const sag = Math.round(Math.sin(((px - 184) / 104) * Math.PI) * 7);
      ctx.fillRect(px, 5 + sag, 2, 1);
    }
    for (const bx of [196, 214, 234, 254, 274]) {
      const sag = Math.round(Math.sin(((bx - 184) / 104) * Math.PI) * 7);
      ctx.fillStyle = INK; ctx.fillRect(bx, 6 + sag, 1, 2);
      ctx.fillStyle = AMBER; ctx.fillRect(bx - 1, 8 + sag, 3, 2);
      ctx.fillStyle = "#fff7d6"; ctx.fillRect(bx, 8 + sag, 1, 1);
    }
    ctx.restore();
  }

  function drawZzz(x, y) {
    const phase = (t * 0.6) % 1;
    ctx.globalAlpha = 1 - phase;
    drawText(ctx, "Z", x + Math.round(phase * 3), y - Math.round(phase * 6), "#5b79c9");
    ctx.globalAlpha = 1;
  }

  function drawTable(tb) {
    const R = (c, x, y, w, h) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
    const outdoor = tb.x >= 184;
    R("rgba(26,35,64,.14)", tb.x - 7, tb.y, 14, 2);
    if (outdoor) {
      // wooden camp table
      R(INK, tb.x - 5, tb.y - 7, 2, 7); R(INK, tb.x + 3, tb.y - 7, 2, 7);
      R("#8a572a", tb.x - 4, tb.y - 7, 1, 6); R("#8a572a", tb.x + 3, tb.y - 7, 1, 6);
      R(INK, tb.x - 8, tb.y - 12, 16, 5);
      R("#d19858", tb.x - 7, tb.y - 11, 14, 2);
      R("#a86e37", tb.x - 7, tb.y - 9, 14, 1);
      if (skyFor(manilaHour()).phase !== "day") {
        // tiny lit camp lantern on the table
        R(INK, tb.x - 1, tb.y - 16, 3, 4);
        R(AMBER, tb.x, tb.y - 15, 1, 2);
        R("#fff7d6", tb.x, tb.y - 14, 1, 1);
      }
    } else if (tb.x > 130) {
      // flat long wooden table in front of the big red sofa (In 3)
      R("rgba(26,35,64,.14)", tb.x - 13, tb.y, 26, 2);
      R(INK, tb.x - 11, tb.y - 7, 2, 7); R(INK, tb.x + 9, tb.y - 7, 2, 7);
      R(INK, tb.x - 14, tb.y - 11, 28, 4); R("#cfa067", tb.x - 13, tb.y - 10, 26, 2);
      R("#a86e37", tb.x - 13, tb.y - 8, 26, 1);
    } else {
      // flat circular wooden tables on black pedestal (In 1 & In 2)
      R(INK, tb.x - 1, tb.y - 7, 2, 7); R(INK, tb.x - 4, tb.y - 1, 8, 2);
      R(INK, tb.x - 7, tb.y - 12, 14, 4); R(INK, tb.x - 8, tb.y - 11, 16, 2);
      R("#cfa067", tb.x - 6, tb.y - 11, 12, 2);
      R("#a86e37", tb.x - 7, tb.y - 10, 14, 1);
    }
  }

  function drawHeart(x, y, age) {
    if (age < 0 || age > 1.4) return;
    const dy = Math.round(age * 5);
    ctx.globalAlpha = Math.max(0, 1 - age / 1.4);
    ctx.fillStyle = "#ff5c8a";
    ctx.fillRect(x, y - dy, 2, 1);
    ctx.fillRect(x + 3, y - dy, 2, 1);
    ctx.fillRect(x, y + 1 - dy, 5, 2);
    ctx.fillRect(x + 1, y + 3 - dy, 3, 1);
    ctx.fillRect(x + 2, y + 4 - dy, 1, 1);
    ctx.globalAlpha = 1;
  }

  function hopOffset(e) {
    if (e.moving || e.act !== "hop") return 0;
    const age = t - (e.actAt ?? t);
    if (age < 0 || age > 0.7) return 0;
    return Math.abs(Math.round(Math.sin(age * Math.PI * 3) * 2));
  }

  function drawCust(c) {
    const bob = (c.moving ? Math.floor(t * 7 + c.id) % 2 : 0) + hopOffset(c);
    const x = Math.round(c.x) - 7, y = Math.round(c.y) - CAT_H - bob;
    const flip = !c.moving && c.act === "look" && c.lookFlip !== undefined ? c.lookFlip : c.flip;
    ctx.fillStyle = "rgba(26,35,64,.14)"; ctx.fillRect(x + 1, Math.round(c.y) - 1, 12, 2);
    drawCat(ctx, x, y, c.coat, { flip, blink: blink(c.id) });
    if (!c.moving && c.act === "happy") drawHeart(x + 5, y - 6, t - (c.actAt ?? t));
    if (!c.cup) return;
    const seat = c.moving ? null : SEATS[seatOf.get(c.id)];
    const sipping = !c.moving && ((t * 1000 + c.id * 911) % 5200) < 900;
    if (seat && !sipping) drawCup(ctx, Math.round(c.x) + (seat.flip ? -12 : 9), Math.round(c.y) - 17);
    else drawCup(ctx, flip ? x - 2 : x + CAT_W - 2, y + (sipping ? 5 : 9));
  }

  function drawVisitor(v) {
    if (!v.moving && v.act === "nap") {
      const x = Math.round(v.x) - 7, y = Math.round(v.y) - 8;
      ctx.fillStyle = "rgba(26,35,64,.14)"; ctx.fillRect(x + 1, Math.round(v.y) - 1, 12, 2);
      drawLoaf(ctx, x, y, v.look?.coat ?? "cream", Math.floor(t / 1.4) % 2);
      drawZzz(x + 11, y - 2);
      return;
    }
    const bob = (v.moving ? Math.floor(t * 7 + v.seed) % 2 : 0) + hopOffset(v);
    const x = Math.round(v.x) - 7, y = Math.round(v.y) - CAT_H - bob;
    const flip = !v.moving && v.act === "look" && v.lookFlip !== undefined ? v.lookFlip : v.flip;
    ctx.fillStyle = "rgba(26,35,64,.14)"; ctx.fillRect(x + 1, Math.round(v.y) - 1, 12, 2);
    drawCat(ctx, x, y, v.look, { flip, blink: blink(200 + v.seed) });
    if (!v.moving && v.act === "happy") drawHeart(x + 5, y - 6, t - (v.actAt ?? t));
  }

  /** Compact ambient camp cat (smaller, 4-legged/loafing style, distinct from upright user sprites). */
  function drawCampCat(n) {
    const coatKey = n.look?.coat ?? "ginger";
    const coat = COAT_COLOURS[coatKey] ?? COAT_COLOURS.ginger;
    const flip = !n.moving && n.act === "look" && n.lookFlip !== undefined ? n.lookFlip : n.flip;
    if (!n.moving && n.act === "nap") {
      const x = Math.round(n.x) - 7, y = Math.round(n.y) - 8;
      ctx.fillStyle = "rgba(26,35,64,.16)"; ctx.fillRect(x + 1, Math.round(n.y) - 1, 12, 2);
      drawLoaf(ctx, x, y, coatKey, Math.floor(t / 1.4) % 2);
      drawZzz(x + 11, y - 2);
      return;
    }
    const hop = hopOffset(n);
    const stepFrame = n.moving ? Math.floor(t * 8 + n.seed) % 2 : 0;
    const cx = Math.round(n.x), cy = Math.round(n.y) - hop;
    const x = cx - 5, y = cy - 8;
    ctx.fillStyle = "rgba(26,35,64,.16)"; ctx.fillRect(x + 1, Math.round(n.y) - 1, 9, 2);
    ctx.save();
    if (flip) { ctx.translate(cx * 2, 0); ctx.scale(-1, 1); }
    // tail (wags gently)
    const tailWag = Math.floor(t * 3 + n.seed) % 2;
    ctx.fillStyle = INK; ctx.fillRect(x - 2, y + 3 - tailWag, 2, 3);
    ctx.fillStyle = coat.k !== coat.f ? coat.k : coat.d; ctx.fillRect(x - 1, y + 3 - tailWag, 1, 2);
    // outline + body + head
    ctx.fillStyle = INK;
    ctx.fillRect(x, y + 3, 9, 4);
    ctx.fillRect(x + 4, y + 1, 6, 4);
    ctx.fillRect(x + 4, y, 2, 1); ctx.fillRect(x + 8, y, 2, 1);
    // fur
    ctx.fillStyle = coat.f;
    ctx.fillRect(x + 1, y + 4, 7, 2);
    ctx.fillRect(x + 5, y + 2, 4, 3);
    // coat markings (stripes or patches) matching drawLoaf/drawCat
    ctx.fillStyle = coat.c !== coat.f ? coat.c : coat.d;
    ctx.fillRect(x + 5, y + 1, 1, 1);
    ctx.fillRect(x + 2, y + 4, 2, 1);
    ctx.fillStyle = coat.k !== coat.f ? coat.k : coat.d;
    ctx.fillRect(x + 8, y + 1, 1, 1);
    if (coat.d !== coat.f) ctx.fillRect(x + 5, y + 4, 1, 1);
    // chest/muzzle accent
    ctx.fillStyle = coat.w;
    ctx.fillRect(x + 8, y + 4, 1, 1);
    // legs
    ctx.fillStyle = INK;
    ctx.fillRect(x + 1 + stepFrame, y + 7, 2, 1);
    ctx.fillRect(x + 6 - stepFrame, y + 7, 2, 1);
    // eye (blinks periodically)
    if (!blink(300 + n.seed)) {
      ctx.fillStyle = coat.e; ctx.fillRect(x + 8, y + 3, 1, 1);
    }
    ctx.restore();
    if (!n.moving && n.act === "happy") drawHeart(cx - 2, y - 6, t - (n.actAt ?? t));
  }

  function drawServer() {
    const bob = server.moving ? Math.floor(t * 7) % 2 : 0;
    const x = Math.round(server.x) - 7, y = Math.round(server.y) - CAT_H - bob;
    ctx.fillStyle = "rgba(26,35,64,.14)"; ctx.fillRect(x + 1, Math.round(server.y) - 1, 12, 2);
    drawCat(ctx, x, y, "white", { apron: true, flip: server.flip, blink: blink(77) });
    if (server.carrying) drawCup(ctx, server.flip ? x - 2 : x + CAT_W - 2, y + 8);
  }

  function draw() {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(room, 0, 0);
    drawWindow();

    // tickets waiting on the rail
    const queued = orders.filter((o) => o.status === "queued").sort((a, b) => a.id - b.id).slice(0, MAX_TICKETS);
    // Each ticket is as wide as its number needs, and the row stops where the rail ends (the board lists the rest).
    let x = 61;
    for (const [i, o] of queued.entries()) {
      const label = ambient ? "" : String(o.label ?? o.id % 1000);
      const w = Math.max(13, textWidth(label) + 4);
      if (x + w > RAIL_END) break;
      const sway = Math.round(Math.sin(t * 2 + i) * 0.6);
      ctx.fillStyle = INK; ctx.fillRect(x + sway, 29, w, 11);
      ctx.fillStyle = "#ffffff"; ctx.fillRect(x + 1 + sway, 29, w - 2, 10);
      ctx.fillStyle = AMBER; ctx.fillRect(x + Math.floor(w / 2) - 1 + sway, 28, 3, 2);
      if (ambient) {
        ctx.fillStyle = "#9db6ee"; ctx.fillRect(x + 3 + sway, 32, 7, 1); ctx.fillRect(x + 3 + sway, 34, 5, 1); ctx.fillRect(x + 3 + sway, 36, 6, 1);
      } else {
        drawText(ctx, label, x + sway + 2, 32, BLUE);
      }
      x += w + 2;
    }

    // baristas, then the counter in front of them
    baristas.forEach((b, i) => {
      const working = assignment[i] != null && !b.moving;
      const bob = working ? Math.floor(t * 6 + i) % 2 : b.moving ? Math.floor(t * 7 + i) % 2 : 0;
      const x = Math.round(b.x) - 7;
      drawCat(ctx, x, BARISTA_TOP - bob, b.coat, { apron: true, flip: b.flip, blink: blink(100 + i) });
      if (working) drawCup(ctx, x + CAT_W - 3, BARISTA_TOP + 6 + (Math.floor(t * 3 + i) % 2));
    });
    paintCounter(ctx);
    if (baristaCount === 0) {
      drawLoaf(ctx, 96, 67, "tuxedo", Math.floor(t / 1.8) % 2);
      drawZzz(116, 60);
    }

    // finished drinks wait on the tray for the server
    let onTray = 0;
    for (const o of orders) {
      if (o.status !== "serving" || custs.get(o.id)?.cup || (server.carrying && server.job === o.id)) continue;
      drawCup(ctx, 148 + (onTray++ % 4) * 7, 68);
    }

    for (const p of steam) {
      ctx.globalAlpha = Math.max(0, p.life) * 0.8;
      ctx.fillStyle = "#ffffff"; ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    }
    ctx.globalAlpha = 1;

    // floor: tables, customers and the server, back to front
    const things = [...TABLES.map((tb) => ({ y: tb.y + 0.5, draw: () => drawTable(tb) })),
      ...[...custs.values()].map((c) => ({ y: c.y, draw: () => drawCust(c) })),
      ...[...visitors.values()].map((v) => ({ y: v.y, draw: () => drawVisitor(v) })),
      ...campCats.map((n) => ({ y: n.y, draw: () => drawCampCat(n) }))];
    if (baristaCount > 0) things.push({ y: server.y, draw: drawServer });
    things.sort((a, b) => a.y - b.y).forEach((th) => th.draw());
    drawLighting(skyFor(manilaHour()));
  }

  function drawLighting(sky) {
    if (sky.phase === "day") return;
    const warmPool = (cx, cy, rx, ry, outer, inner) => {
      const r = Math.max(rx, ry);
      const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
      grad.addColorStop(0, inner);
      grad.addColorStop(0.55, outer);
      grad.addColorStop(1, "rgba(255, 200, 90, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    const lampCone = (lx, alphaOuter, alphaInner) => {
      ctx.fillStyle = `rgba(255, 210, 115, ${alphaOuter})`;
      ctx.beginPath();
      ctx.moveTo(lx - 4, 10);
      ctx.lineTo(lx + 5, 10);
      ctx.lineTo(lx + 26, 62);
      ctx.lineTo(lx - 25, 62);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 240, 185, ${alphaInner})`;
      ctx.beginPath();
      ctx.moveTo(lx - 2, 10);
      ctx.lineTo(lx + 3, 10);
      ctx.lineTo(lx + 14, 48);
      ctx.lineTo(lx - 13, 48);
      ctx.closePath();
      ctx.fill();
    };

    if (sky.phase === "afternoon") {
      // warm golden-hour wash indoors & outdoors
      ctx.fillStyle = "rgba(255, 168, 76, 0.12)";
      ctx.fillRect(0, 0, 181, H);
      ctx.fillStyle = "rgba(255, 152, 64, 0.15)";
      ctx.fillRect(184, 53, 104, H - 53);
      // golden sunbeam from indoor window
      ctx.fillStyle = "rgba(255, 224, 145, 0.12)";
      ctx.beginPath();
      ctx.moveTo(152, 10); ctx.lineTo(178, 10); ctx.lineTo(164, 76); ctx.lineTo(128, 76);
      ctx.closePath(); ctx.fill();
      for (const lx of [66, 102, 136]) lampCone(lx, 0.12, 0.14);
      for (const bx of [196, 214, 234, 254, 274]) {
        const sag = Math.round(Math.sin(((bx - 184) / 104) * Math.PI) * 7);
        warmPool(bx, 9 + sag, 4, 4, "rgba(255, 210, 100, 0.22)", "rgba(255, 242, 185, 0.25)");
      }
      for (const tb of TABLES.slice(3)) warmPool(tb.x, tb.y - 12, 11, 7, "rgba(255, 198, 92, 0.12)", "rgba(255, 235, 165, 0.14)");
      return;
    }

    if (sky.phase === "dawn") {
      ctx.fillStyle = "rgba(125, 148, 225, 0.12)";
      ctx.fillRect(0, 0, 181, H);
      ctx.fillStyle = "rgba(110, 132, 210, 0.16)";
      ctx.fillRect(184, 53, 104, H - 53);
      for (const lx of [66, 102, 136]) lampCone(lx, 0.10, 0.12);
      for (const bx of [196, 214, 234, 254, 274]) {
        const sag = Math.round(Math.sin(((bx - 184) / 104) * Math.PI) * 7);
        warmPool(bx, 9 + sag, 4, 4, "rgba(255, 210, 100, 0.18)", "rgba(255, 242, 185, 0.20)");
      }
      return;
    }

    // night mode: cozy twilight indoors, starry camp outdoors with warm lamps, string lights & table lanterns
    ctx.fillStyle = "rgba(16, 26, 66, 0.30)";
    ctx.fillRect(0, 0, 181, H);
    ctx.fillStyle = "rgba(14, 22, 56, 0.42)";
    ctx.fillRect(184, 53, 104, H - 53);

    for (const lx of [66, 102, 136]) {
      lampCone(lx, 0.18, 0.20);
      warmPool(lx, 11, 5, 4, "rgba(255, 214, 110, 0.30)", "rgba(255, 247, 214, 0.42)");
    }
    // left corner floor lamp & right couch mushroom lamp warm glow
    warmPool(3, 48, 12, 18, "rgba(255, 210, 110, 0.24)", "rgba(255, 242, 185, 0.32)");
    // subtle counter POS screen glow
    warmPool(85, 67, 8, 5, "rgba(127, 176, 255, 0.16)", "rgba(195, 224, 255, 0.18)");
    // outdoor festoon string light glow
    for (const bx of [196, 214, 234, 254, 274]) {
      const sag = Math.round(Math.sin(((bx - 184) / 104) * Math.PI) * 7);
      warmPool(bx, 9 + sag, 6, 5, "rgba(255, 200, 90, 0.26)", "rgba(255, 242, 180, 0.36)");
    }
    // outdoor camp table lantern pools
    for (const tb of TABLES.slice(3)) {
      warmPool(tb.x, tb.y - 11, 14, 9, "rgba(255, 194, 85, 0.22)", "rgba(255, 238, 175, 0.24)");
    }
  }

  // ---------- labels ----------
  function tag(key, cls, text, x, y) {
    let el = tags.get(key);
    if (!el) {
      el = document.createElement("div");
      tagLayer.append(el);
      tags.set(key, el);
    }
    if (el.className !== cls) el.className = cls;
    if (el.textContent !== text) el.textContent = text;
    el.style.left = `${(x / W) * 100}%`;
    el.style.top = `${(y / H) * 100}%`;
    el.dataset.live = "1";
  }

  function label() {
    for (const el of tags.values()) el.dataset.live = "";
    const byId = new Map(orders.map((o) => [o.id, o]));
    if (!ambient) {
      for (const c of custs.values()) {
        if (c.phase === "in" && !c.cup) tag(`c${c.id}`, "tag", byId.get(c.id)?.label ?? String(c.id), c.x, c.y - CAT_H - 2);
      }
    }
    for (const v of visitors.values()) {
      if (v.phase !== "in") continue;
      tag(`v${v.key}`, "tag visitor", v.name, v.x, v.y - CAT_H + Math.min(0, catBounds(v.look).y0) - 2);
    }
    baristas.forEach((b, i) => {
      const o = byId.get(assignment[i]);
      if (!o) return;
      const items = o.items?.length ? o.items : [{ name: "", qty: 1 }];
      const drink = itemsLabel([items[Math.floor(t / 2.5) % items.length]]);
      tag(`b${i}`, "tag bubble", ambient ? drink : `${o.label ?? o.id} · ${drink}`, b.x, BARISTA_TOP - 3 - (i % 2) * 9);
    });
    for (const [key, el] of tags) if (!el.dataset.live) { el.remove(); tags.delete(key); }
  }

  function frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    t += dt;
    step(dt);
    draw();
    label();
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    sync,
    setAmbient(on) { ambient = Boolean(on); },
    /** Where every floor cat is right now. Read-only; for checks and debugging, never for drawing. */
    cats() {
      return {
        customers: [...custs.values()].map((c) => ({ id: c.id, x: Math.round(c.x), y: Math.round(c.y), phase: c.phase, visitorKey: c.visitorKey ?? null })),
        visitors: [...visitors.values()].map((v) => ({ key: v.key, x: Math.round(v.x), y: Math.round(v.y), phase: v.phase })),
      };
    },
    destroy() { cancelAnimationFrame(raf); for (const el of tags.values()) el.remove(); tags.clear(); },
  };
}
