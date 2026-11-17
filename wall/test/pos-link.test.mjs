import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPosFeed, sseParser } from "../pos-link.mjs";

const order = (over = {}) => ({ id: 7, number: 3, name: "Ana", items: [{ name: "Matcha", qty: 2 }], status: "queued", createdAt: 100, updatedAt: 200, ...over });

test("maps the till's orders onto the wall's sheet", () => {
  const state = fromPosFeed({ day: "2026-11-17", orders: [order({ id: 9, number: 5, status: "serving" }), order()] }, 2);
  assert.equal(state.day, "2026-11-17");
  assert.equal(state.baristas, 2);
  assert.equal(state.seq, 5);
  // the wall shows the number the customer was told (3 and 5), not the till's internal ids (7 and 9)
  assert.deepEqual(state.orders.map((o) => [o.id, o.status]), [[3, "queued"], [5, "serving"]]);
  assert.deepEqual(state.orders[0], { id: 3, name: "Ana", items: [{ name: "Matcha", qty: 2 }], status: "queued", createdAt: 100, updatedAt: 200 });
});

test("two open orders that share a number across midnight stay apart", () => {
  const state = fromPosFeed({ day: "2026-11-18", orders: [order({ id: 41, number: 1 }), order({ id: 40, number: 1, status: "serving" })] }, 1);
  assert.deepEqual(state.orders.map((o) => [o.id, o.status]), [[1, "serving"], [1001, "queued"]]);
});

test("a voided order is a cancelled one on the wall, a done one stays done", () => {
  const state = fromPosFeed({ day: "2026-11-17", orders: [order({ id: 1, number: 1, status: "voided" }), order({ id: 2, number: 2, status: "done" })] }, 1);
  assert.deepEqual(state.orders.map((o) => o.status), ["cancelled", "done"]);
});

test("an empty till is an empty cafe, not an error", () => {
  assert.deepEqual(fromPosFeed({ day: "2026-11-17", orders: [] }, 3), { day: "2026-11-17", seq: 0, baristas: 3, orders: [] });
});

test("never passes money or anything else through", () => {
  const state = fromPosFeed({ day: "2026-11-17", orders: [order({ totalCentavos: 500, phone: "0917" })] }, 1);
  assert.deepEqual(Object.keys(state.orders[0]).sort(), ["createdAt", "id", "items", "name", "status", "updatedAt"]);
});

test("refuses a feed it cannot trust", () => {
  assert.equal(fromPosFeed(null, 1), null);
  assert.equal(fromPosFeed({ day: "today", orders: [] }, 1), null);
  assert.equal(fromPosFeed({ day: "2026-11-17", orders: [order({ status: "exploded" })] }, 1), null);
  assert.equal(fromPosFeed({ day: "2026-11-17", orders: [order({ id: 0 })] }, 1), null);
  assert.equal(fromPosFeed({ day: "2026-11-17", orders: [order({ number: undefined })] }, 1), null);
  // an order with no drinks is skipped rather than shown as an empty ticket
  assert.deepEqual(fromPosFeed({ day: "2026-11-17", orders: [order({ items: [] })] }, 1).orders, []);
});

test("reads server-sent events across split chunks", () => {
  const seen = [];
  const parse = sseParser((data) => seen.push(data));
  parse("retry: 2000\n\ndata: {\"a\"");
  parse(":1}\n\n: keepalive\n\ndata: {\"b\":2}\r\n\r\ndata: par");
  assert.deepEqual(seen, ['{"a":1}', '{"b":2}']);
  parse("tial\n\n");
  assert.deepEqual(seen, ['{"a":1}', '{"b":2}', "partial"]);
});
