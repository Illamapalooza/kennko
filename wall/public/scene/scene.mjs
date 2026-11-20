// The cat cafe: a 288 x 152 pixel room drawn on a canvas, with crisp DOM labels laid over it.
// Table service: customers sit down, a barista makes the drink, a server cat carries it over.
import { drawCat, drawLoaf, drawCup, drawText, textWidth, CAT_W, CAT_H, INK, BLUE, AMBER } from "./sprites.mjs";
import { coatFor, assignBaristas, assignSlots, itemsLabel } from "./logic.mjs";

export const W = 288;
export const H = 152;

// Positions are a cat's feet: centre x, bottom y.
const WAIT = [26, 48, 70, 92, 114, 136].map((x) => ({ x, y: 122 })); // standing room, only when every seat is taken
// listed in the order they fill, so the room looks evenly busy
const TABLES = [{ x: 172, y: 142 }, { x: 60, y: 142 }, { x: 214, y: 112 }, { x: 258, y: 142 }, { x: 112, y: 142 }, { x: 214, y: 142 }, { x: 258, y: 112 }];
const SEATS = TABLES.flatMap((t) => [{ x: t.x - 15, y: t.y, flip: false, table: t }, { x: t.x + 15, y: t.y, flip: true, table: t }]);
const DOOR = { x: -12, y: 136 };
const STATIONS = [62, 104, 132];
const BARISTA_TOP = 63;
const BARISTA_COATS = ["tuxedo", "ginger", "tabby"];
const TRAY = { x: 160, y: 116 }; // where the server collects drinks
const SERVER_HOME = { x: 188, y: 102 };
const WALK = 30; // px per second
const MAX_TICKETS = 6;

const rand = (a, b) => a + Math.random() * (b - a);

function paintRoom(g) {
  const R = (c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  // wall and wainscot
  R("#f7faff", 0, 0, W, 64); R("#dfe9ff", 0, 44, W, 20); R("#c5d6ff", 0, 44, W, 1);
  for (let x = 6; x < W; x += 12) R("#d2dffb", x, 46, 1, 17);
  R("#b3c6f2", 0, 63, W, 1);
  // floor
  for (let y = 64, row = 0; y < H; y += 12, row++) {
    for (let x = 0, col = 0; x < W; x += 12, col++) R((row + col) % 2 ? "#eef3ff" : "#e0e9fc", x, y, 12, 12);
  }
  R("#cdd9f3", 12, 64, 166, 12);
  // lamps
  for (const x of [70, 164, 260]) {
    R(INK, x, 0, 1, 6); R(AMBER, x - 3, 6, 7, 3); R(INK, x - 4, 9, 9, 1); R("#fff7d6", x - 1, 10, 3, 1);
  }
  // menu board
  R(INK, 13, 9, 42, 34); R(BLUE, 14, 10, 40, 32);
  drawText(g, "MENU", 34 - Math.floor(textWidth("MENU") / 2), 13, "#ffffff");
  for (let i = 0; i < 5; i++) { R("#bcd0ff", 18, 22 + i * 4, 20, 1); R(AMBER, 44, 22 + i * 4, 5, 1); }
  // the Kennko wordmark hangs at the centre of this wall; it is the real logo, laid over the canvas by the page
  // ticket rail
  R(INK, 58, 28, 96, 1);
  // cup shelf
  R("#8fa4d6", 155, 40, 30, 2);
  for (let i = 0; i < 4; i++) drawCup(g, 158 + i * 7, 34);
  // window frame and sill (the sky is painted live)
  R(INK, 189, 9, 44, 39); R("#ffffff", 187, 46, 48, 3); R(INK, 187, 49, 48, 1);
  // framed portrait of the house cat
  R(INK, 245, 16, 26, 24); R("#ffffff", 246, 17, 24, 22); R(AMBER, 248, 19, 20, 18);
  drawCat(g, 251, 23, "tuxedo", { rows: 10 });
  // plants
  R("#2f8f55", 185, 62, 2, 9); R("#3fae6a", 188, 58, 2, 13); R("#2f8f55", 191, 63, 2, 8); R("#3fae6a", 186, 60, 1, 4);
  R(INK, 183, 70, 11, 8); R("#e9eefb", 184, 71, 9, 6); R(BLUE, 184, 73, 9, 1);
  R("#2f8f55", 276, 60, 2, 11); R("#3fae6a", 279, 56, 2, 15); R("#2f8f55", 282, 62, 2, 9);
  R(INK, 274, 70, 11, 8); R("#e9eefb", 275, 71, 9, 6); R(BLUE, 275, 73, 9, 1);
  // door mat
  R(AMBER, 0, 127, 8, 18); R("#e09a1c", 0, 127, 8, 1); R("#e09a1c", 0, 144, 8, 1);
}

function paintCounter(g) {
  const R = (c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  R(INK, 11, 75, 168, 27);
  R("#ffffff", 12, 76, 166, 5); R("#c5d2ee", 12, 81, 166, 1);
  R(BLUE, 12, 82, 166, 17); R("#0041c4", 12, 99, 166, 2);
  for (const x of [40, 68, 124, 152]) R("#0047d9", x, 84, 1, 13); // the centre panel carries the logo
  // espresso machine
  R(INK, 23, 57, 29, 20); R("#dfe4ef", 24, 58, 27, 18); R("#f5f7fb", 24, 58, 27, 3); R(BLUE, 24, 63, 27, 2);
  R(INK, 29, 67, 5, 3); R(INK, 40, 67, 5, 3); R("#8d97b3", 26, 74, 23, 2); R(AMBER, 46, 59, 2, 1);
  // the counter tablet
  R(INK, 84, 71, 2, 5); R(INK, 78, 62, 14, 10); R("#7fb0ff", 79, 63, 12, 8); R("#ffffff", 81, 65, 5, 1); R("#ffffff", 81, 67, 8, 1);
  // milk pitcher
  R(INK, 115, 68, 8, 8); R("#e9eefb", 116, 69, 6, 6); R(INK, 123, 70, 2, 4);
  // serving tray
  R(INK, 145, 74, 30, 3); R(AMBER, 146, 74, 28, 2);
}

function skyFor(hour) {
  if (hour >= 6 && hour < 16.5) return { top: "#7cc4ff", low: "#c6e8ff", stars: false };
  if (hour >= 16.5 && hour < 18.5) return { top: "#ff9f6b", low: "#ffd98a", stars: false };
  if (hour >= 5 && hour < 6) return { top: "#8fa6e8", low: "#ffd0b0", stars: false };
  return { top: "#24336e", low: "#3d4f96", stars: true };
}

/**
 * @param {HTMLCanvasElement} canvas 288 x 152
 * @param {HTMLElement} tagLayer positioned box exactly over the canvas
 * @param {{manilaHour?: () => number}} [opts]
 */
export function createScene(canvas, tagLayer, opts = {}) {
  const ctx = canvas.getContext("2d");
  const room = document.createElement("canvas");
  room.width = W; room.height = H;
  paintRoom(room.getContext("2d"));
  const manilaHour = opts.manilaHour ?? (() => ((Date.now() / 3600000 + 8) % 24));

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
  const tags = new Map();
  let t = 0; // seconds
  let last = performance.now();
  let raf = 0;

  const freeSeat = () => { const used = new Set(seatOf.values()); for (let i = 0; i < SEATS.length; i++) if (!used.has(i)) return i; return -1; };
  const go = (c, p) => { c.tx = p.x; c.ty = p.y; };
  const isActive = (o) => o.status === "queued" || o.status === "preparing" || o.status === "serving";

  function leave(c) {
    seatOf.delete(c.id);
    c.phase = "leave";
    go(c, DOOR);
  }

  /** Bring the cats in line with the orders. `initial` places them without walking in. */
  function sync(nextOrders, count, initial = false) {
    orders = nextOrders;
    baristaCount = count;
    const preparing = orders.filter((o) => o.status === "preparing").sort((a, b) => a.updatedAt - b.updatedAt || a.id - b.id).map((o) => o.id);
    assignment = assignBaristas(assignment, preparing, count);

    // seats first, oldest order first; whoever is left stands and waits
    const active = orders.filter(isActive).sort((a, b) => a.id - b.id);
    for (const o of active) {
      if (seatOf.has(o.id)) continue;
      const seat = freeSeat();
      if (seat >= 0) seatOf.set(o.id, seat);
    }
    waitSlots = assignSlots(waitSlots, active.filter((o) => !seatOf.has(o.id)).map((o) => o.id), WAIT.length);

    const seen = new Set();
    for (const o of orders) {
      seen.add(o.id);
      let c = custs.get(o.id);
      if (!c && isActive(o)) {
        c = { id: o.id, coat: coatFor(o.id), x: DOOR.x, y: DOOR.y, tx: DOOR.x, ty: DOOR.y, phase: "in", cup: false, flip: false, leaveAt: 0, snap: initial };
        custs.set(o.id, c);
      }
      if (!c) continue;
      if (isActive(o)) {
        c.phase = "in";
        if (o.status !== "serving") c.cup = false;
        const seat = seatOf.get(o.id);
        const slot = waitSlots.get(o.id);
        go(c, seat !== undefined ? SEATS[seat] : slot >= 0 ? WAIT[slot] : { x: 20 + (o.id % 6) * 17, y: 150 });
      } else if (o.status === "done") {
        if (c.phase === "in") { c.cup = true; c.phase = "finish"; c.leaveAt = t + rand(6, 14); }
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

  function step(dt) {
    for (const c of custs.values()) {
      if (!walk(c, dt)) continue;
      const seat = SEATS[seatOf.get(c.id)];
      if (seat && c.phase !== "leave") c.flip = seat.flip;
      if (c.phase === "finish" && t > c.leaveAt) leave(c);
      else if (c.phase === "leave") custs.delete(c.id);
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
    ctx.save();
    ctx.beginPath(); ctx.rect(191, 11, 40, 34); ctx.clip();
    ctx.fillStyle = sky.top; ctx.fillRect(191, 11, 40, 22);
    ctx.fillStyle = sky.low; ctx.fillRect(191, 33, 40, 12);
    if (sky.stars) {
      ctx.fillStyle = "#ffffff";
      for (const [x, y] of [[196, 15], [207, 19], [221, 14], [226, 24], [201, 27], [214, 30]]) {
        if (Math.floor(t * 1.5 + x) % 5) ctx.fillRect(x, y, 1, 1);
      }
      ctx.fillStyle = "#fff3c4"; ctx.fillRect(222, 16, 4, 4);
    } else {
      ctx.fillStyle = "#ffffff";
      for (const [speed, y, w] of [[2.2, 15, 12], [1.4, 24, 9]]) {
        const x = 185 + ((t * speed + y * 7) % 56);
        ctx.fillRect(Math.round(x), y, w, 3); ctx.fillRect(Math.round(x) + 2, y - 2, w - 5, 2);
      }
    }
    ctx.restore();
    ctx.fillStyle = INK; ctx.fillRect(210, 11, 1, 34); ctx.fillRect(191, 27, 40, 1);
    drawLoaf(ctx, 196, 37, "cream", Math.floor(t / 1.6) % 2);
    drawZzz(216, 30);
  }

  function drawZzz(x, y) {
    const phase = (t * 0.6) % 1;
    ctx.globalAlpha = 1 - phase;
    drawText(ctx, "Z", x + Math.round(phase * 3), y - Math.round(phase * 6), "#5b79c9");
    ctx.globalAlpha = 1;
  }

  function drawTable(tb) {
    const R = (c, x, y, w, h) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
    R("rgba(26,35,64,.12)", tb.x - 7, tb.y, 14, 2);
    R(INK, tb.x - 1, tb.y - 7, 2, 7); R(INK, tb.x - 4, tb.y - 1, 8, 2);
    R(INK, tb.x - 8, tb.y - 12, 16, 5); R("#ffffff", tb.x - 7, tb.y - 11, 14, 3); R(BLUE, tb.x - 7, tb.y - 9, 14, 1);
  }

  function drawCust(c) {
    const bob = c.moving ? Math.floor(t * 7 + c.id) % 2 : 0;
    const x = Math.round(c.x) - 7, y = Math.round(c.y) - CAT_H - bob;
    ctx.fillStyle = "rgba(26,35,64,.14)"; ctx.fillRect(x + 1, Math.round(c.y) - 1, 12, 2);
    drawCat(ctx, x, y, c.coat, { flip: c.flip, blink: blink(c.id) });
    if (!c.cup) return;
    const seat = c.moving ? null : SEATS[seatOf.get(c.id)];
    const sipping = !c.moving && ((t * 1000 + c.id * 911) % 5200) < 900;
    if (seat && !sipping) drawCup(ctx, Math.round(c.x) + (seat.flip ? -12 : 9), Math.round(c.y) - 17);
    else drawCup(ctx, c.flip ? x - 2 : x + CAT_W - 2, y + (sipping ? 5 : 9));
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
    queued.forEach((o, i) => {
      const x = 61 + i * 15, sway = Math.round(Math.sin(t * 2 + i) * 0.6);
      ctx.fillStyle = INK; ctx.fillRect(x + sway, 29, 13, 11);
      ctx.fillStyle = "#ffffff"; ctx.fillRect(x + 1 + sway, 29, 11, 10);
      ctx.fillStyle = AMBER; ctx.fillRect(x + 5 + sway, 28, 3, 2);
      if (ambient) {
        ctx.fillStyle = "#9db6ee"; ctx.fillRect(x + 3 + sway, 32, 7, 1); ctx.fillRect(x + 3 + sway, 34, 5, 1); ctx.fillRect(x + 3 + sway, 36, 6, 1);
      } else {
        const label = o.label ?? String(o.id % 1000);
        drawText(ctx, label, x + sway + 7 - Math.floor(textWidth(label) / 2), 32, BLUE);
      }
    });

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
      ...[...custs.values()].map((c) => ({ y: c.y, draw: () => drawCust(c) }))];
    if (baristaCount > 0) things.push({ y: server.y, draw: drawServer });
    things.sort((a, b) => a.y - b.y).forEach((th) => th.draw());
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
    destroy() { cancelAnimationFrame(raf); for (const el of tags.values()) el.remove(); tags.clear(); },
  };
}
