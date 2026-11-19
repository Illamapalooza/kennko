// Kennko order pad: builds orders and moves them along. The wall follows whatever this sends.
import { itemsLabel } from "/scene/logic.mjs";

const $ = (id) => document.getElementById(id);
const PIN_KEY = "kennko-pad-pin";
const NEXT = { queued: "Start", preparing: "Ready", serving: "Done" };
const STARS = "★ Bestsellers";

let boot = { menu: [], pinRequired: false };
let state = null;
let pin = "";
let tab = STARS;
const cart = new Map(); // drink name -> qty
let sending = false;

try { pin = localStorage.getItem(PIN_KEY) ?? ""; } catch { /* private mode: ask every time */ }

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

let toastTimer;
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 4000);
}

function askPin(message = "") {
  $("gate-error").textContent = message;
  $("gate").hidden = false;
  $("pin").value = "";
  $("pin").focus();
}

async function post(path, body, headers = {}) {
  let res;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Can't reach the wall computer. Check the wifi.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "That didn't work. Try again.");
    err.status = res.status;
    throw err;
  }
  return data;
}

async function act(action) {
  try {
    return await post("/api/action", action, { "x-pin": pin });
  } catch (err) {
    if (err.status === 401 || err.status === 429) askPin(err.message);
    else toast(err.message);
    return null;
  }
}

// ---------- order builder ----------
function categories() {
  const stars = boot.menu.flatMap((c) => c.items.filter((i) => i.star));
  return [{ category: STARS, items: stars }, ...boot.menu].filter((c) => c.items.length);
}

function renderTabs() {
  const cats = categories();
  if (!cats.some((c) => c.category === tab)) tab = cats[0]?.category ?? "";
  $("tabs").replaceChildren(...cats.map((c) => {
    const b = el("button", { type: "button", textContent: c.category });
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(c.category === tab));
    b.addEventListener("click", () => { tab = c.category; renderTabs(); });
    return b;
  }));
  const items = cats.find((c) => c.category === tab)?.items ?? [];
  $("drinks").replaceChildren(...items.map((item) => {
    const b = el("button", { type: "button", textContent: item.name, className: item.star && tab !== STARS ? "star" : "" });
    b.addEventListener("click", () => { cart.set(item.name, Math.min(20, (cart.get(item.name) ?? 0) + 1)); renderCart(); });
    return b;
  }));
}

function renderCart() {
  $("cart").replaceChildren(...[...cart].map(([name, qty]) => {
    const less = el("button", { type: "button", textContent: "−" });
    less.setAttribute("aria-label", `One fewer ${name}`);
    less.addEventListener("click", () => { if (qty > 1) cart.set(name, qty - 1); else cart.delete(name); renderCart(); });
    const more = el("button", { type: "button", textContent: "+" });
    more.setAttribute("aria-label", `One more ${name}`);
    more.addEventListener("click", () => { cart.set(name, Math.min(20, qty + 1)); renderCart(); });
    return el("li", {}, el("span", { textContent: name }), less, el("b", { textContent: String(qty) }), more);
  }));
  $("send").disabled = cart.size === 0 || sending;
}

$("send").addEventListener("click", async () => {
  if (cart.size === 0 || sending) return;
  sending = true;
  $("send").disabled = true;
  const items = [...cart].map(([name, qty]) => ({ name, qty }));
  const result = await act({ type: "create", name: $("name").value, items });
  sending = false;
  if (result?.created) {
    cart.clear();
    $("name").value = "";
    $("sent-number").textContent = String(result.created);
    $("sent").hidden = false;
    $("sent-ok").focus();
  }
  renderCart();
});
$("sent-ok").addEventListener("click", () => { $("sent").hidden = true; });
$("sent").addEventListener("click", (e) => { if (e.target === $("sent")) $("sent").hidden = true; });

// ---------- lanes ----------
function card(order) {
  const head = el("div", { className: "card-head" }, el("strong", { textContent: String(order.id) }));
  if (order.name) head.append(el("span", { textContent: order.name }));
  const box = el("article", { className: `card ${order.status}` }, head, el("p", { textContent: itemsLabel(order.items) }));
  const go = el("button", { type: "button", className: "go", textContent: NEXT[order.status] });
  go.addEventListener("click", () => act({ type: "advance", id: order.id }));
  const minor = el("div", { className: "card-minor" });
  if (order.status !== "queued") {
    const back = el("button", { type: "button", textContent: "↩ Back" });
    back.setAttribute("aria-label", `Move order ${order.id} back one step`);
    back.addEventListener("click", () => act({ type: "undo", id: order.id }));
    minor.append(back);
  }
  const cancel = el("button", { type: "button", className: "danger", textContent: "Cancel" });
  cancel.setAttribute("aria-label", `Cancel order ${order.id}`);
  cancel.addEventListener("click", () => {
    if (confirm(`Cancel order ${order.id}? It comes off the wall.`)) act({ type: "cancel", id: order.id });
  });
  minor.append(cancel);
  box.append(go, minor);
  return box;
}

function doneCard(order) {
  const cancelled = order.status === "cancelled";
  const head = el("div", { className: "card-head" }, el("strong", { textContent: String(order.id) }),
    el("span", { textContent: cancelled ? "Cancelled" : order.auto ? "Cleared itself" : order.name || "Done" }));
  const back = el("button", { type: "button", textContent: cancelled ? "↩ Restore" : "↩ Back to serving" });
  back.addEventListener("click", () => act({ type: "undo", id: order.id }));
  return el("article", { className: `card done ${cancelled ? "cancelled" : ""}` }, head, el("div", { className: "card-minor" }, back));
}

function renderLanes() {
  if (!state) return;
  for (const status of ["queued", "preparing", "serving"]) {
    const list = state.orders.filter((o) => o.status === status)
      .sort((a, b) => (status === "queued" ? a.id - b.id : a.updatedAt - b.updatedAt || a.id - b.id));
    $(`lane-${status}`).replaceChildren(...list.map(card));
    $(`n-${status}`).textContent = list.length ? String(list.length) : "";
  }
  const finished = state.orders.filter((o) => o.status === "done" || o.status === "cancelled")
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  $("lane-done").replaceChildren(...finished.map(doneCard));
  $("shift-count").textContent = String(state.baristas);
  $("next-number").textContent = `#${state.seq + 1}`;
}

$("shift-less").addEventListener("click", () => { if (state && state.baristas > 0) act({ type: "baristas", count: state.baristas - 1 }); });
$("shift-more").addEventListener("click", () => { if (state && state.baristas < 3) act({ type: "baristas", count: state.baristas + 1 }); });

// ---------- start ----------
$("gate").addEventListener("submit", async (e) => {
  e.preventDefault();
  const tried = $("pin").value.trim();
  try {
    await post("/api/pin", { pin: tried });
    pin = tried;
    try { localStorage.setItem(PIN_KEY, pin); } catch { /* fine */ }
    $("gate").hidden = true;
  } catch (err) {
    askPin(err.message);
  }
});

function listen() {
  const source = new EventSource("/api/events");
  source.onmessage = (e) => {
    $("link").hidden = true;
    try { state = JSON.parse(e.data).state; } catch { return; }
    renderLanes();
  };
  source.onerror = () => { $("link").hidden = false; };
}

async function start() {
  try {
    boot = await (await fetch("/api/bootstrap")).json();
  } catch {
    toast("Can't reach the wall computer. Check the wifi, then reload.");
    return;
  }
  renderTabs();
  renderCart();
  listen();
  if (boot.pinRequired) {
    if (!pin) askPin();
    else try { await post("/api/pin", { pin }); } catch (err) { askPin(err.message); }
  }
}
start();

// Offline copy of the scene's files. Needs https or localhost, so on a plain LAN address the page simply runs without it.
if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
