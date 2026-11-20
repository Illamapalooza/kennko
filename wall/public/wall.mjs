// The wall: listens for order changes, drives the scene and the board, plays the playlist.
import { createScene, W, H } from "/scene/scene.mjs";
import { boardView, itemsLabel, shuffled } from "/scene/logic.mjs";

const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };

let boot = { volume: 0.5, boardSize: 5, padUrls: [], ambient: true };
let opened = false;
const scene = createScene($("scene"), $("tags"));

// ---------- layout ----------
function fit() {
  const stage = $("stage");
  const px = Math.max(1, Math.floor(Math.min((stage.clientWidth - 16) / W, (stage.clientHeight - 24) / H)));
  document.documentElement.style.setProperty("--px", `${px}px`);
}
addEventListener("resize", fit);
fit();

const clockFormat = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
function tickClock() { $("clock").textContent = clockFormat.format(new Date()); }
tickClock();
setInterval(tickClock, 5000);

// ---------- sound ----------
const audio = new Audio();
audio.preload = "auto";
let actx = null;
let tracks = [];
let queue = [];
let lastUrl = "";
let fails = 0;
let muted = false;
let duckTimer = 0;
let retryTimer = 0;

const baseVolume = () => (muted ? 0 : boot.volume);

async function nextTrack() {
  clearTimeout(retryTimer);
  if (queue.length === 0) {
    try { tracks = await (await fetch("/api/playlist")).json(); } catch { tracks = []; }
    queue = shuffled(tracks);
    if (queue.length > 1 && queue[0].url === lastUrl) queue.push(queue.shift());
  }
  const track = queue.shift();
  if (!track) {
    // nothing to play: stay quiet and look again later, in case tracks are added mid-shift
    $("music").hidden = true;
    retryTimer = setTimeout(nextTrack, 60000);
    return;
  }
  lastUrl = track.url;
  audio.src = track.url;
  audio.volume = baseVolume();
  $("track").textContent = track.title;
  $("music").hidden = false;
  audio.play().catch(() => { /* an unplayable file raises "error" below; a blocked play waits for a tap */ });
}
audio.addEventListener("playing", () => { fails = 0; });
audio.addEventListener("ended", nextTrack);
audio.addEventListener("error", () => {
  if (!opened) return;
  fails++;
  if (fails >= Math.max(1, tracks.length)) {
    // every track failed in a row: don't spin, try again in a minute
    fails = 0;
    queue = [];
    $("music").hidden = true;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(nextTrack, 60000);
  } else nextTrack();
});

function bell() {
  if (!actx || muted) return;
  const now = actx.currentTime;
  for (const [freq, delay] of [[1318.5, 0], [1760, 0.17]]) {
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + delay);
    gain.gain.exponentialRampToValueAtTime(0.35, now + delay + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 1.3);
    osc.connect(gain).connect(actx.destination);
    osc.start(now + delay);
    osc.stop(now + delay + 1.4);
  }
  audio.volume = baseVolume() * 0.3;
  clearTimeout(duckTimer);
  duckTimer = setTimeout(() => { audio.volume = baseVolume(); }, 1900);
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
}

// ---------- live state ----------
let known = null; // order id -> status, from the previous snapshot
function apply(state) {
  const fresh = new Set();
  if (known && !boot.ambient) {
    for (const o of state.orders) {
      if (o.status === "serving" && known.get(o.id) !== "serving") { fresh.add(o.id); banners.push(o); }
    }
  }
  scene.sync(state.orders, state.baristas, known === null);
  known = new Map(state.orders.map((o) => [o.id, o.status]));
  if (!boot.ambient) renderBoard(state, fresh);
  if (banners.length > 4) banners.splice(0, banners.length - 4);
  showBanner();
}

function listen() {
  const source = new EventSource("/api/events");
  source.onmessage = (e) => {
    $("link").hidden = true;
    let data;
    try { data = JSON.parse(e.data); } catch { return; }
    apply(data.state);
  };
  source.onerror = () => { $("link").hidden = false; };
}

// ---------- start ----------
function open() {
  if (opened) return;
  opened = true;
  $("start").hidden = true;
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = null; }
  nextTrack();
  document.documentElement.requestFullscreen?.().catch(() => { /* fullscreen is a nicety */ });
  fit();
}
$("open").addEventListener("click", open);

addEventListener("keydown", (e) => {
  if (!opened || e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === "m") { muted = !muted; audio.volume = baseVolume(); }
  else if (key === "n") nextTrack();
  else if (key === "f") {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }
});
document.addEventListener("fullscreenchange", fit);

async function start() {
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
  hint.append(el("br"), "Keys: M mute · N next song · F full screen");
  listen();
}
start();

// Offline copy of the scene's files. Needs https or localhost, so on a plain LAN address the page simply runs without it.
if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
