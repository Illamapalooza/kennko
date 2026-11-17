import { test } from "node:test";
import assert from "node:assert/strict";
import { reduce, emptyState, manilaDay, normalize, OrderError } from "../store.mjs";

const T0 = Date.UTC(2026, 10, 16, 2, 0, 0); // 10:00 Manila
const latte = [{ name: "Café Latte", qty: 1 }];
const fresh = () => emptyState(manilaDay(T0), 2);
const order = (s, id) => s.orders.find((o) => o.id === id);

test("manilaDay rolls over at Manila midnight, not UTC midnight", () => {
  assert.equal(manilaDay(Date.UTC(2026, 10, 16, 15, 59)), "2026-11-16");
  assert.equal(manilaDay(Date.UTC(2026, 10, 16, 16, 0)), "2026-11-17");
});

test("orders number from 1 and start queued", () => {
  let s = reduce(fresh(), { type: "create", name: "  Ana ", items: latte }, T0);
  s = reduce(s, { type: "create", items: latte }, T0 + 1);
  assert.deepEqual(s.orders.map((o) => [o.id, o.name, o.status]), [[1, "Ana", "queued"], [2, "", "queued"]]);
  assert.equal(s.seq, 2);
});

test("a new Manila day clears the sheet and keeps the barista count", () => {
  let s = reduce(fresh(), { type: "create", items: latte }, T0);
  s = reduce(s, { type: "create", items: latte }, T0 + 24 * 3600 * 1000);
  assert.equal(s.day, "2026-11-17");
  assert.equal(s.baristas, 2);
  assert.deepEqual(s.orders.map((o) => o.id), [1]);
});

test("advance walks the whole flow, then refuses", () => {
  let s = reduce(fresh(), { type: "create", items: latte }, T0);
  for (const status of ["preparing", "serving", "done"]) {
    s = reduce(s, { type: "advance", id: 1 }, T0 + 5);
    assert.equal(order(s, 1).status, status);
  }
  assert.throws(() => reduce(s, { type: "advance", id: 1 }, T0 + 6), OrderError);
});

test("undo steps back one state and refuses on a queued order", () => {
  let s = reduce(fresh(), { type: "create", items: latte }, T0);
  assert.throws(() => reduce(s, { type: "undo", id: 1 }, T0), OrderError);
  s = reduce(s, { type: "advance", id: 1 }, T0);
  s = reduce(s, { type: "advance", id: 1 }, T0);
  s = reduce(s, { type: "undo", id: 1 }, T0);
  assert.equal(order(s, 1).status, "preparing");
});

test("cancel remembers where the order was, and undo restores it", () => {
  let s = reduce(fresh(), { type: "create", items: latte }, T0);
  s = reduce(s, { type: "advance", id: 1 }, T0);
  s = reduce(s, { type: "cancel", id: 1 }, T0);
  assert.equal(order(s, 1).status, "cancelled");
  assert.throws(() => reduce(s, { type: "advance", id: 1 }, T0), OrderError);
  assert.throws(() => reduce(s, { type: "cancel", id: 1 }, T0), OrderError);
  s = reduce(s, { type: "undo", id: 1 }, T0);
  assert.equal(order(s, 1).status, "preparing");
});

test("a serving order nobody closes clears itself", () => {
  let s = reduce(fresh(), { type: "create", items: latte }, T0);
  s = reduce(s, { type: "advance", id: 1 }, T0);
  s = reduce(s, { type: "advance", id: 1 }, T0);
  const opts = { autoclearMs: 60000 };
  assert.equal(order(reduce(s, { type: "tick" }, T0 + 59999, opts), 1).status, "serving");
  const cleared = reduce(s, { type: "tick" }, T0 + 60000, opts);
  assert.equal(order(cleared, 1).status, "done");
  assert.equal(order(cleared, 1).auto, true);
});

test("tick with nothing to do returns the same object", () => {
  const s = fresh();
  assert.equal(reduce(s, { type: "tick" }, T0), s);
});

test("items are validated against the menu and merged", () => {
  const opts = { menuNames: new Set(["Café Latte", "Matcha"]) };
  const s = reduce(fresh(), { type: "create", items: [...latte, { name: "Matcha", qty: 2 }, ...latte] }, T0, opts);
  assert.deepEqual(order(s, 1).items, [{ name: "Café Latte", qty: 2 }, { name: "Matcha", qty: 2 }]);
  const bad = [[], null, [{ name: "Beer", qty: 1 }], [{ name: "Matcha", qty: 0 }], [{ name: "Matcha", qty: 1.5 }],
    [{ name: "Matcha", qty: 21 }], [{ name: "Matcha", qty: 15 }, { name: "Matcha", qty: 15 }], [{ qty: 1 }]];
  for (const items of bad) {
    assert.throws(() => reduce(fresh(), { type: "create", items }, T0, opts), OrderError, JSON.stringify(items));
  }
});

test("names are trimmed, stripped of control characters and capped", () => {
  const s = reduce(fresh(), { type: "create", name: "Maria\nClara de los Santos", items: latte }, T0);
  assert.equal(order(s, 1).name, "MariaClara de lo");
});

test("barista count is bounded", () => {
  assert.equal(reduce(fresh(), { type: "baristas", count: 0 }, T0).baristas, 0);
  for (const count of [-1, 4, 1.5, "2", undefined]) {
    assert.throws(() => reduce(fresh(), { type: "baristas", count }, T0), OrderError);
  }
});

test("unknown orders and actions are refused", () => {
  assert.throws(() => reduce(fresh(), { type: "advance", id: 9 }, T0), OrderError);
  assert.throws(() => reduce(fresh(), { type: "explode" }, T0), OrderError);
  assert.throws(() => reduce(fresh(), null, T0), OrderError);
});

test("normalize round-trips a real state and rejects junk", () => {
  let s = reduce(fresh(), { type: "create", name: "Jo", items: latte }, T0);
  s = reduce(s, { type: "cancel", id: 1 }, T0);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(s))), s);
  const junk = [null, 7, {}, { ...s, day: "today" }, { ...s, seq: -1 }, { ...s, baristas: 9 }, { ...s, orders: {} },
    { ...s, orders: [{ ...s.orders[0], status: "lost" }] }, { ...s, orders: [{ ...s.orders[0], id: 5 }] },
    { ...s, orders: [{ ...s.orders[0], items: [{ name: 1, qty: 1 }] }] }];
  for (const raw of junk) assert.equal(normalize(raw), null, JSON.stringify(raw));
});
