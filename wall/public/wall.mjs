// The wall: listens for order changes, drives the scene and the board, plays sound effects.
import { createScene, W, H } from "./scene/scene.mjs";
import { boardView, deliveryView, itemsLabel, clockOffset, qrCell, sceneEvents } from "./scene/logic.mjs";
import { createSfx } from "./sfx.mjs";

const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };

let boot = { volume: 0.5, boardSize: 5, padUrls: [], ambient: true };
let opened = false;
// Visitors' end times are on the till's clock; the projector may be another PC with its own idea of the time.
// Offset = the till's time when the feed was sent - this browser's time when it arrived.
let tillOffset = 0;
const scene = createScene($("scene"), $("tags"), { clock: () => Date.now() + tillOffset });

// ---------- layout ----------
function fit() {
  const px = Math.max(1, Math.min(innerWidth / W, innerHeight / H));
  document.documentElement.style.setProperty("--px", `${px}px`);
}
addEventListener("resize", fit);
fit();

const clockFormat = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
function tickClock() { $("clock").textContent = clockFormat.format(new Date()); }
tickClock();
setInterval(tickClock, 5000);

// ---------- sound ----------
let actx = null;
let sfx = createSfx(null);

function bell() {
  sfx.play("ready");
}

// What the customer was told: "W3" for an online order, else the counter number.
const shownNumber = (order) => order.label ?? String(order.id);

// ---------- ready banner ----------
const banners = [];
let bannerBusy = false;
function showBanner() {
  if (bannerBusy) return;
  const order = banners.shift();
  if (!order) return;
  bannerBusy = true;
  $("banner-number").textContent = shownNumber(order);
  $("banner-name").textContent = order.name ? `for ${order.name}` : "";
  $("banner").hidden = false;
  bell();
  setTimeout(() => { $("banner").hidden = true; bannerBusy = false; showBanner(); }, 5000);
}

// ---------- board ----------
function row(order, fresh) {
  const li = el("li", null, fresh ? "fresh" : "");
  const text = el("div");
  const drinks = itemsLabel(order.items);
  if (order.name) text.append(el("b", order.name), el("small", drinks));
  else text.append(el("b", drinks));
  li.append(el("strong", shownNumber(order)), text);
  return li;
}

const DELIVERY_STAGE = {
  placed: "Queued",
  preparing: "Preparing",
  ready: "Ready",
  out_for_delivery: "Out for delivery",
};

function renderDeliveries(orders) {
  const box = $("deliveries");
  const list = deliveryView(orders);
  box.hidden = list.length === 0;
  if (list.length === 0) {
    $("b-deliveries").replaceChildren();
    return;
  }
  $("b-deliveries").replaceChildren(
    ...list.slice(0, 6).map((o) => {
      const li = document.createElement("li");
      const stage = DELIVERY_STAGE[o.prepStatus] ?? (o.status === "preparing" ? "Preparing" : o.status === "serving" ? "Ready" : "Queued");
      li.append(el("strong", shownNumber(o)));
      if (o.name) li.append(el("span", o.name));
      li.append(el("em", stage));
      return li;
    }),
  );
}

function renderBoard(state, freshIds) {
  const closed = state.baristas === 0;
  $("board").classList.toggle("is-closed", closed);
  $("closed").hidden = !closed;
  const view = boardView(state.orders, boot.boardSize);
  $("b-preparing").replaceChildren(...view.preparing.shown.map((o) => row(o, false)));
  $("b-serving").replaceChildren(...view.serving.shown.map((o) => row(o, freshIds.has(o.id))));
  $("m-preparing").textContent = view.preparing.more ? `+${view.preparing.more} more` : "";
  $("m-serving").textContent = view.serving.more ? `+${view.serving.more} more` : "";
  const chips = view.queued.shown.map((o) => el("span", shownNumber(o)));
  if (view.queued.more) chips.push(el("span", `+${view.queued.more}`));
  $("b-queued").replaceChildren(...chips);
  renderDeliveries(state.orders);
  fit();
}

// ---------- live state ----------
let known = null; // order id -> status, from the previous snapshot
let qrModules = null;
function renderQr() {
  const card = $("checkin-card");
  card.hidden = !qrModules;
  document.body.classList.toggle("has-qr", Boolean(qrModules));
  if (!qrModules) return;
  const n = qrModules.length;
  const cell = qrCell(n, Math.min(innerHeight * 0.14, innerWidth * 0.1));
  const size = (n + 8) * cell; // 4-module quiet zone on every side, whole pixels per module
  const canvas = $("checkin");
  canvas.width = size; canvas.height = size;
  canvas.style.width = `${size}px`; canvas.style.height = `${size}px`;
  const g = canvas.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, size, size);
  g.fillStyle = "#0d1b3d";
  qrModules.forEach((row, y) => { for (let x = 0; x < n; x++) if (row[x] === "1") g.fillRect((x + 4) * cell, (y + 4) * cell, cell, cell); });
}
let qrKey = "";
function setCheckin(checkin) {
  const key = checkin ? checkin.modules.join("") : "";
  if (key === qrKey) return;
  qrKey = key;
  qrModules = checkin ? checkin.modules : null;
  renderQr();
}
addEventListener("resize", renderQr);

let prevScene = null;
function apply(state, visit) {
  tillOffset = clockOffset(visit?.tillNow, Date.now());
  const fresh = new Set();
  if (known && !boot.ambient) {
    for (const o of state.orders) {
      if (o.status === "serving" && known.get(o.id) !== "serving") { fresh.add(o.id); banners.push(o); }
    }
  }
  const visitors = visit?.visitors ?? [];
  for (const kind of sceneEvents(prevScene, { orders: state.orders, visitors })) {
    if (kind !== "ready") sfx.play(kind);
  }
  prevScene = { orders: state.orders, visitors };
  scene.sync(state.orders, state.baristas, known === null, visitors);
  setCheckin(boot.ambient ? null : visit?.checkin ?? null);
  known = new Map(state.orders.map((o) => [o.id, o.status]));
  if (!boot.ambient) renderBoard(state, fresh);
  if (banners.length > 4) banners.splice(0, banners.length - 4);
  showBanner();
}

function listen(sourceUrl = "/api/events") {
  const source = typeof sourceUrl === "string" ? new EventSource(sourceUrl) : sourceUrl;
  source.onmessage = (e) => {
    $("link").hidden = true;
    let data;
    try { data = JSON.parse(e.data); } catch { return; }
    apply(data.state, data.visit);
  };
  source.onerror = () => { $("link").hidden = false; };
  return source;
}

// ---------- start ----------
function open() {
  if (opened) return;
  opened = true;
  $("start").hidden = true;
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = null; }
  sfx = createSfx(actx);
  document.documentElement.requestFullscreen?.().catch(() => { /* fullscreen is a nicety */ });
  fit();
}
$("open").addEventListener("click", open);

addEventListener("keydown", (e) => {
  if (!opened || e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === "m") { sfx.muted = !sfx.muted; }
  else if (key === "f") {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }
});
document.addEventListener("fullscreenchange", fit);

async function start() {
  if (window.Capacitor?.isNativePlatform?.()) {
    const { bootApp } = await import("./app/boot.mjs");
    bootApp({
      apply,
      setBoot: (next) => {
        boot = { ...boot, ...next };
        document.body.classList.toggle("ambient", Boolean(boot.ambient));
        scene.setAmbient(boot.ambient);
        fit();
      },
      setSfxMuted: (m) => { sfx.muted = Boolean(m); },
      setLink: (show, text) => {
        const pill = $("link");
        pill.hidden = !show;
        if (text) pill.textContent = text;
      },
    });
    return;
  }
  try { boot = { ...boot, ...(await (await fetch("/api/bootstrap")).json()) }; } catch { /* keep defaults; events will retry */ }
  document.body.classList.toggle("ambient", Boolean(boot.ambient));
  scene.setAmbient(boot.ambient);
  fit();
  const hint = $("pad-hint");
  if (boot.ambient) { /* no pad in visuals-only mode */ } else if (boot.pos) {
    hint.append("Orders come from the till.");
  } else if (boot.padUrls?.length) {
    hint.append("Order pad for the counter tablet: ", el("b", boot.padUrls[0]));
  } else hint.textContent = "No wifi found. The order pad only works on this computer for now.";
  hint.append(el("br"), "Keys: M mute · F full screen");
  listen();
}
start();

// Offline copy of the scene's files. Needs https or localhost, so on a plain LAN address the page simply runs without it.
if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
