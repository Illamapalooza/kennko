import test from "node:test";
import assert from "node:assert/strict";
import { createFollower } from "../public/follow.mjs";
import { fromPosFeed } from "../public/pos-feed.mjs";

const qr21 = Array.from({ length: 21 }, () => "1".repeat(21));

const sampleFeed = (over = {}) => ({
  day: "2026-11-22",
  now: 1_700_000_000_000,
  orders: [
    { id: 1, number: 1, status: "queued", items: [{ name: "Latte", qty: 1 }], name: "Maya", createdAt: 1000, updatedAt: 1000 },
  ],
  visitors: [{ key: "v1", name: "Mochi", look: { coat: "calico" }, endsAt: 1_700_000_060_000 }],
  checkin: { url: "https://kennko.vercel.app/c?c=ABC", modules: qr21 },
  ...over,
});

test("feed builds the wall sheet", () => {
  let clock = 5000;
  const snapshots = [];
  const f = createFollower({
    baristas: 2,
    board: true,
    now: () => clock,
    onSnapshot: (s) => snapshots.push(s),
  });
  const feed = sampleFeed();
  f.feed(feed);
  const expected = fromPosFeed(feed, 2);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].state.day, expected.day);
  assert.deepEqual(snapshots[0].state.orders, expected.orders);
  assert.deepEqual(snapshots[0].visit.checkin, expected.checkin);
});

test("down clears the QR but keeps orders on the board", () => {
  let clock = 5000;
  const f = createFollower({ baristas: 2, board: true, now: () => clock, onSnapshot: () => {} });
  f.feed(sampleFeed());
  f.down();
  const snap = f.snapshot();
  assert.equal(snap.visit.checkin, null);
  assert.equal(snap.state.orders.length, 1);
});

test("down without board stands in after 15s", () => {
  let clock = 1000;
  let standInCalls = 0;
  const timers = new Map();
  let nextId = 1;
  const f = createFollower({
    baristas: 2,
    board: false,
    now: () => clock,
    timers: {
      set: (fn, ms) => { const id = nextId++; timers.set(id, { fn, at: clock + ms }); return id; },
      clear: (id) => timers.delete(id),
    },
    onStandIn: () => { standInCalls++; },
    onSnapshot: () => {},
  });
  f.feed(sampleFeed());
  f.down();
  assert.equal(standInCalls, 0);
  clock = 15999;
  for (const [id, t] of [...timers]) if (t.at <= clock) { timers.delete(id); t.fn(); }
  assert.equal(standInCalls, 0);
  clock = 16000;
  for (const [id, t] of [...timers]) if (t.at <= clock) { timers.delete(id); t.fn(); }
  assert.equal(standInCalls, 1);
});

test("up after down resumes the till's orders", () => {
  let clock = 1000;
  const f = createFollower({ baristas: 2, board: true, now: () => clock, onSnapshot: () => {} });
  f.feed(sampleFeed());
  f.down();
  f.up();
  f.feed(sampleFeed({ orders: [{ id: 2, number: 2, status: "preparing", items: [{ name: "Matcha", qty: 1 }], name: "", createdAt: 2000, updatedAt: 2000 }] }));
  assert.equal(f.snapshot().state.orders[0].id, 2);
});

test("garbled feed is ignored", () => {
  let clock = 1000;
  const f = createFollower({ baristas: 2, board: true, now: () => clock, onSnapshot: () => {} });
  f.feed(sampleFeed());
  f.feed("not-an-object");
  f.feed({ day: "bad", orders: [] });
  assert.equal(f.snapshot().state.orders.length, 1);
});
