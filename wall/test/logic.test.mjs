import { test } from "node:test";
import assert from "node:assert/strict";
import { coatFor, COATS, assignBaristas, assignSlots, boardView, VISIT_SPOTS, SEAT_SPOTS, visitorView, clockOffset, qrCell, itemsLabel, shuffled, claimVisitors, sameLook } from "../public/scene/logic.mjs";
import { CAT_FRONT, COAT_COLOURS, GLYPHS } from "../public/scene/sprites.mjs";

test("a coat is stable per order and every coat gets used", () => {
  assert.equal(coatFor(12), coatFor(12));
  assert.equal(new Set(Array.from({ length: 8 }, (_, i) => coatFor(i + 1))).size, COATS.length);
});

test("baristas keep their order and a free one takes the oldest waiting", () => {
  assert.deepEqual(assignBaristas([], [4, 5, 6], 2), [4, 5]);
  assert.deepEqual(assignBaristas([4, 5], [5, 6], 2), [6, 5]);
  assert.deepEqual(assignBaristas([4, 5], [4, 5, 6], 3), [4, 5, 6]);
  assert.deepEqual(assignBaristas([4, 5, 6], [4, 5, 6], 1), [4]);
  assert.deepEqual(assignBaristas([4], [], 2), [null, null]);
  assert.deepEqual(assignBaristas(undefined, [1], 0), []);
});

test("slots are sticky, lowest free first, and overflow gets -1", () => {
  const a = assignSlots(new Map(), [1, 2, 3], 2);
  assert.deepEqual([...a], [[1, 0], [2, 1], [3, -1]]);
  const b = assignSlots(a, [2, 3, 4], 2);
  assert.deepEqual([...b], [[2, 1], [3, 0], [4, -1]]);
});

test("the board shows the oldest few and counts the rest", () => {
  const orders = [1, 2, 3, 4].map((id) => ({ id, status: "preparing", updatedAt: 100 - id }));
  orders.push({ id: 5, status: "serving", updatedAt: 1 }, { id: 6, status: "done", updatedAt: 1 });
  const view = boardView(orders, 3);
  assert.deepEqual(view.preparing.shown.map((o) => o.id), [4, 3, 2]);
  assert.equal(view.preparing.more, 1);
  assert.deepEqual(view.serving.shown.map((o) => o.id), [5]);
  assert.deepEqual(view.queued, { shown: [], more: 0 });
});

test("item labels read cleanly", () => {
  assert.equal(itemsLabel([{ name: "Matcha", qty: 2 }, { name: "Americano", qty: 1 }]), "2× Matcha, Americano");
  assert.equal(itemsLabel(undefined), "");
});

test("shuffle keeps every track", () => {
  const list = ["a", "b", "c", "d"];
  assert.deepEqual(shuffled(list, () => 0.5).sort(), list);
  assert.deepEqual(shuffled([]), []);
});

test("sprite maps are rectangular and every coat colours every key", () => {
  const width = CAT_FRONT[0].length;
  for (const row of CAT_FRONT) assert.equal(row.length, width, row);
  const keys = new Set(CAT_FRONT.join("").replace(/\./g, ""));
  for (const coat of COATS) {
    for (const key of keys) assert.ok(COAT_COLOURS[coat][key], `${coat} lacks ${key}`);
  }
  for (const [ch, rows] of Object.entries(GLYPHS)) {
    assert.equal(rows.length, 5, ch);
    for (const row of rows) assert.equal(row.length, rows[0].length, ch);
  }
});

test("12 visit spots, all inside the room, off the counter, away from every seat", () => {
  assert.equal(VISIT_SPOTS.length, 12);
  assert.equal(new Set(VISIT_SPOTS.map((p) => `${p.x},${p.y}`)).size, 12);
  for (const p of VISIT_SPOTS) {
    assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y) && typeof p.flip === "boolean");
    assert.ok(p.x >= 7 && p.x <= 288 - 7 && p.y >= 16 && p.y <= 152, `${p.x},${p.y} inside 288 x 152`);
    assert.ok(!(p.x >= 11 && p.x <= 179 && p.y >= 75 && p.y <= 102), `${p.x},${p.y} off the counter`);
    for (const s of SEAT_SPOTS) assert.ok(Math.hypot(p.x - s.x, p.y - s.y) > 8, `${p.x},${p.y} clear of seat ${s.x},${s.y}`);
  }
});

test("visitorView drops the expired and puts the newest first", () => {
  const v = (key, endsAt) => ({ key, name: key, look: { coat: "ginger" }, endsAt });
  const view = visitorView([v("old", 1500), v("gone", 1000), v("new", 9000), v("mid", 5000)], 1000);
  assert.deepEqual(view.map((x) => x.key), ["new", "mid", "old"]);
  assert.equal(visitorView(Array.from({ length: 20 }, (_, i) => v(`k${i}`, 5000 + i)), 0).length, 12);
});

test("expiry follows the till's clock even when the wall's clock is minutes off", () => {
  const tillNow = 1_000_000;
  const wallLocal = tillNow + 5 * 60_000; // the projector PC runs 5 minutes fast
  const offset = clockOffset(tillNow, wallLocal);
  const visit = [{ key: "a", name: "Mochi", look: { coat: "tabby" }, endsAt: tillNow + 60_000 }];
  // by the raw local clock the visit looks ended 4 minutes ago; on the till's clock it has a minute left
  assert.equal(visitorView(visit, wallLocal).length, 0);
  assert.equal(visitorView(visit, wallLocal + offset).length, 1);
  assert.equal(visitorView(visit, wallLocal + 70_000 + offset).length, 0);
  assert.equal(clockOffset(null, wallLocal), 0);
  assert.equal(clockOffset(Number.NaN, wallLocal), 0);
});

test("the QR cell is a whole number of pixels, the card fits the box", () => {
  assert.equal(qrCell(29, 370), 10);
  assert.equal(qrCell(29, 20), 1);
  assert.ok(Number.isInteger(qrCell(33, 301)));
});

// ---------- one cat per customer ----------
const cat = (key, name, look) => ({ key, name, look, endsAt: 9e15 });
const ord = (id, over = {}) => ({ id, status: "queued", name: "", ...over });

test("an order that names its visitor uses that cat", () => {
  const claims = claimVisitors([ord(4, { visitor: "k1", look: { coat: "ginger" } })], [cat("k1", "Mochi", { coat: "ginger" }), cat("k2", "Kape", { coat: "black" })]);
  assert.deepEqual([...claims], [[4, "k1"]]);
});

test("an order with only a look takes the visiting cat that wears it, not a second cat", () => {
  const claims = claimVisitors([ord(4, { look: { hat: "beanie", coat: "ginger" } })], [cat("k1", "Mochi", { coat: "ginger", hat: "beanie" })]);
  assert.deepEqual([...claims], [[4, "k1"]]);
});

test("two cats in the same clothes: the one with the order's name is taken", () => {
  const twins = [cat("k1", "Biko", { coat: "black" }), cat("k2", "Kape", { coat: "black" })];
  assert.deepEqual([...claimVisitors([ord(4, { name: "kape", look: { coat: "black" } })], twins)], [[4, "k2"]]);
});

test("one cat is given to one order only, the oldest first; the next gets none", () => {
  const claims = claimVisitors([ord(9, { visitor: "k1" }), ord(4, { visitor: "k1" })], [cat("k1", "Mochi", { coat: "ginger" })]);
  assert.deepEqual([...claims], [[4, "k1"]]);
});

test("a named visitor that is not on the wall, a plain order and a cancelled order claim nothing", () => {
  const here = [cat("k1", "Mochi", { coat: "ginger" })];
  assert.equal(claimVisitors([ord(4, { visitor: "gone" })], here).size, 0);
  assert.equal(claimVisitors([ord(4)], here).size, 0);
  assert.equal(claimVisitors([ord(4, { visitor: "k1", status: "cancelled" })], here).size, 0);
});

test("an explicit key wins over a look match by an older order", () => {
  const here = [cat("k1", "Mochi", { coat: "ginger" })];
  const claims = claimVisitors([ord(4, { look: { coat: "ginger" } }), ord(9, { visitor: "k1", look: { coat: "ginger" } })], here);
  assert.deepEqual([...claims], [[9, "k1"]]);
});

test("sameLook compares slot by slot", () => {
  assert.equal(sameLook({ coat: "ginger", hat: "beanie" }, { hat: "beanie", coat: "ginger" }), true);
  assert.equal(sameLook({ coat: "ginger" }, { coat: "ginger", hat: "beanie" }), false);
  assert.equal(sameLook(null, { coat: "ginger" }), false);
});
