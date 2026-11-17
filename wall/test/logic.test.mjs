import { test } from "node:test";
import assert from "node:assert/strict";
import { coatFor, COATS, assignBaristas, assignSlots, boardView, itemsLabel, trackTitle, shuffled } from "../public/scene/logic.mjs";
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

test("item labels and track titles read cleanly", () => {
  assert.equal(itemsLabel([{ name: "Matcha", qty: 2 }, { name: "Americano", qty: 1 }]), "2× Matcha, Americano");
  assert.equal(itemsLabel(undefined), "");
  assert.equal(trackTitle("03 - lofi_morning.mp3"), "lofi morning");
  assert.equal(trackTitle("12. Sunset.flac"), "Sunset");
  assert.equal(trackTitle("1999.mp3"), "1999");
  assert.equal(trackTitle("Cafe Bossa.m4a"), "Cafe Bossa");
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
