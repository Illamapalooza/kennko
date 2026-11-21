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

test("a counter order and an online order with the same number stay apart, W shows as W3", () => {
  const state = fromPosFeed({ day: "2026-11-20", orders: [
    order({ id: 7, number: 3, createdAt: 100 }),
    order({ id: 3, number: 3, series: "W", name: "Ana", createdAt: 200 }),
  ] }, 1);
  assert.deepEqual(state.orders.map((o) => [o.id, o.label]), [[3, undefined], [5003, "W3"]]);
  assert.ok(!("label" in state.orders[0]));
  assert.equal(state.seq, 5003);
});

test("a counter order keeps its wall id whether or not online orders are around", () => {
  const counter = [order({ id: 7, number: 3, createdAt: 100 }), order({ id: 8, number: 4, createdAt: 300 })];
  const alone = fromPosFeed({ day: "2026-11-20", orders: counter }, 1);
  const withW = fromPosFeed({ day: "2026-11-20", orders: [order({ id: 1, number: 1, series: "W", createdAt: 50 }), ...counter, order({ id: 2, number: 3, series: "W", createdAt: 350 })] }, 1);
  const ids = (s) => s.orders.filter((o) => !o.label).map((o) => o.id);
  assert.deepEqual(ids(withW), ids(alone));
});

test("a series of C or anything unknown is read as a counter order", () => {
  const state = fromPosFeed({ day: "2026-11-20", orders: [order({ id: 1, number: 2, series: "C" }), order({ id: 2, number: 4, series: "Z" })] }, 1);
  assert.deepEqual(state.orders.map((o) => [o.id, o.label]), [[2, undefined], [4, undefined]]);
});

test("two W1s across midnight stay apart", () => {
  const state = fromPosFeed({ day: "2026-11-21", orders: [
    order({ id: 20, number: 1, series: "W", createdAt: 200 }),
    order({ id: 10, number: 1, series: "W", createdAt: 100 }),
  ] }, 1);
  assert.deepEqual(state.orders.map((o) => [o.id, o.label]), [[5001, "W1"], [6001, "W1"]]);
});

test("orders are taken oldest first by createdAt, then id, so an older W order claims its number first", () => {
  const state = fromPosFeed({ day: "2026-11-21", orders: [
    order({ id: 5, number: 1, createdAt: 300 }),
    order({ id: 9, number: 1, series: "W", createdAt: 100 }),
    order({ id: 2, number: 1, createdAt: 300 }),
  ] }, 1);
  // W (oldest) is first; the two counter 1s share a time, so the lower id keeps 1 and the other moves aside
  assert.deepEqual(state.orders.map((o) => [o.id, o.label]).sort((a, b) => a[0] - b[0]), [[1, undefined], [1001, undefined], [5001, "W1"]]);
});

test("a voided order is a cancelled one on the wall, a done one stays done", () => {
  const state = fromPosFeed({ day: "2026-11-17", orders: [order({ id: 1, number: 1, status: "voided" }), order({ id: 2, number: 2, status: "done" })] }, 1);
  assert.deepEqual(state.orders.map((o) => o.status), ["cancelled", "done"]);
});

test("an empty till is an empty cafe, not an error", () => {
  assert.deepEqual(fromPosFeed({ day: "2026-11-17", orders: [] }, 3), { day: "2026-11-17", seq: 0, baristas: 3, orders: [], visitors: [], checkin: null, tillNow: null });
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

const visitor = (over = {}) => ({ key: "k1", name: "Mochi", look: { coat: "ginger", hat: "beanie" }, endsAt: 5000, ...over });
const feedOf = (extra = {}) => ({ day: "2026-11-20", orders: [], ...extra });

test("visitors pass through with only key, name, look and endsAt", () => {
  const state = fromPosFeed(feedOf({ visitors: [visitor({ customerId: "c-1", email: "a@b.c" })] }), 1);
  assert.deepEqual(state.visitors, [{ key: "k1", name: "Mochi", look: { coat: "ginger", hat: "beanie" }, endsAt: 5000 }]);
});

test("a visitor look keeps only the slot keys", () => {
  const state = fromPosFeed(feedOf({ visitors: [visitor({ look: { coat: "tabby", hat: "crown", balance: 99, nonsense: "x" } })] }), 1);
  assert.deepEqual(state.visitors[0].look, { coat: "tabby", hat: "crown" });
});

test("a bad visitor is dropped and the others stay", () => {
  const state = fromPosFeed(feedOf({ visitors: [
    visitor({ key: "a", look: { hat: "beanie" } }),
    visitor({ key: "b" }),
    visitor({ key: "c", endsAt: "soon" }),
    visitor({ key: "", name: "x" }),
    visitor({ key: "k".repeat(65) }),
    visitor({ key: "d", name: 5 }),
    null,
  ] }), 1);
  assert.deepEqual(state.visitors.map((v) => v.key), ["b"]);
});

test("at most 12 visitors are kept", () => {
  const many = Array.from({ length: 15 }, (_, i) => visitor({ key: `k${i}` }));
  assert.equal(fromPosFeed(feedOf({ visitors: many }), 1).visitors.length, 12);
});

test("a long cat name is cut to 16", () => {
  assert.equal(fromPosFeed(feedOf({ visitors: [visitor({ name: "x".repeat(30) })] }), 1).visitors[0].name, "x".repeat(16));
});

test("checkin needs an https url and a square of 0/1 strings", () => {
  const modules = ["101", "010", "101"];
  assert.deepEqual(fromPosFeed(feedOf({ checkin: { url: "https://kennko.vercel.app/here?c=abc", modules, secret: "no" } }), 1).checkin, { url: "https://kennko.vercel.app/here?c=abc", modules });
  assert.equal(fromPosFeed(feedOf({ checkin: { url: "http://x/here", modules } }), 1).checkin, null);
  assert.equal(fromPosFeed(feedOf({ checkin: { url: "https://x/here", modules: ["101", "01"] } }), 1).checkin, null);
  assert.equal(fromPosFeed(feedOf({ checkin: { url: "https://x/here", modules: ["101", "010", "1x1"] } }), 1).checkin, null);
  assert.equal(fromPosFeed(feedOf({ checkin: { url: "https://x/here", modules: [] } }), 1).checkin, null);
  assert.equal(fromPosFeed(feedOf({ checkin: null }), 1).checkin, null);
});

test("a feed without the keys gives no visitors and no check-in", () => {
  const state = fromPosFeed(feedOf(), 1);
  assert.deepEqual(state.visitors, []);
  assert.equal(state.checkin, null);
});

test("the till's clock comes along as tillNow, or null", () => {
  assert.equal(fromPosFeed(feedOf({ now: 123456 }), 1).tillNow, 123456);
  assert.equal(fromPosFeed(feedOf({ now: "x" }), 1).tillNow, null);
  assert.equal(fromPosFeed(feedOf(), 1).tillNow, null);
});
