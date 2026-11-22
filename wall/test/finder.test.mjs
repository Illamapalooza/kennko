import test from "node:test";
import assert from "node:assert/strict";
import { createFinder } from "../public/app/finder.mjs";

function fakeClock() {
  let now = 1000;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    wait: (ms) => new Promise((resolve) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn: resolve });
    }),
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    async advance(ms) {
      const target = now + ms;
      await Promise.resolve();
      await Promise.resolve();
      while (true) {
        let earliest = null;
        for (const [id, t] of timers) {
          if (t.at <= target && (!earliest || t.at < earliest.t.at)) earliest = { id, t };
        }
        if (!earliest) break;
        now = earliest.t.at;
        timers.delete(earliest.id);
        earliest.t.fn();
        await Promise.resolve();
        await Promise.resolve();
      }
      now = target;
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

test("connects to the discovered till and saves it", async () => {
  const clk = fakeClock();
  let savedUrl = null;
  const opened = [];
  const states = [];
  const finder = createFinder({
    find: async () => ({ host: "192.168.1.50", port: 4466 }),
    open: (url, handlers) => {
      opened.push(url);
      queueMicrotask(() => handlers.onUp());
      return { close: () => {} };
    },
    saved: { get: () => savedUrl, set: (u) => { savedUrl = u; } },
    manual: () => "",
    now: clk.now,
    wait: clk.wait,
    timers: { set: clk.setTimer, clear: clk.clearTimer },
    onState: (s, d) => states.push([s, d]),
  });

  finder.start();
  await clk.advance(10);
  assert.deepEqual(opened, ["http://192.168.1.50:4466"]);
  assert.equal(savedUrl, "http://192.168.1.50:4466");
  assert.equal(states.at(-1)[0], "connected");
  finder.stop();
});

test("falls back to the saved address when discovery finds nothing", async () => {
  const clk = fakeClock();
  const opened = [];
  const finder = createFinder({
    find: async () => ({ none: true }),
    open: (url, handlers) => {
      opened.push(url);
      queueMicrotask(() => handlers.onUp());
      return { close: () => {} };
    },
    saved: { get: () => "http://192.168.1.40:4466", set: () => {} },
    manual: () => "http://192.168.1.99:4466",
    now: clk.now,
    wait: clk.wait,
    timers: { set: clk.setTimer, clear: clk.clearTimer },
    onState: () => {},
  });

  finder.start();
  await clk.advance(10);
  assert.deepEqual(opened, ["http://192.168.1.40:4466"]);
  finder.stop();
});

test("then to the manual address", async () => {
  const clk = fakeClock();
  const opened = [];
  const finder = createFinder({
    find: async () => ({ none: true }),
    open: (url, handlers) => {
      opened.push(url);
      if (url === "http://192.168.1.40:4466") queueMicrotask(() => handlers.onDown());
      else queueMicrotask(() => handlers.onUp());
      return { close: () => {} };
    },
    saved: { get: () => "http://192.168.1.40:4466", set: () => {} },
    manual: () => "http://192.168.1.99:4466",
    now: clk.now,
    wait: clk.wait,
    timers: { set: clk.setTimer, clear: clk.clearTimer },
    onState: () => {},
  });

  finder.start();
  await clk.advance(10);
  assert.deepEqual(opened, ["http://192.168.1.40:4466", "http://192.168.1.99:4466"]);
  finder.stop();
});

test("says lost after 30s without a connection", async () => {
  const clk = fakeClock();
  const states = [];
  const finder = createFinder({
    find: async () => ({ none: true }),
    open: (_url, handlers) => {
      queueMicrotask(() => handlers.onDown());
      return { close: () => {} };
    },
    saved: { get: () => null, set: () => {} },
    manual: () => "",
    now: clk.now,
    wait: clk.wait,
    timers: { set: clk.setTimer, clear: clk.clearTimer },
    onState: (s, d) => states.push([s, d]),
  });

  finder.start();
  await clk.advance(35_000);
  const lost = states.find(([s]) => s === "lost");
  assert.ok(lost, "expected lost state");
  assert.equal(lost[1], "Can't find Kennko POS. Is the tablet on, with Kennko POS open? Still looking.");
  finder.stop();
});

test("reconnects after a drop without blanking", async () => {
  const clk = fakeClock();
  const states = [];
  let handle;
  let attempt = 0;
  const finder = createFinder({
    find: async () => ({ host: "192.168.1.50", port: 4466 }),
    open: (_url, handlers) => {
      attempt++;
      handle = handlers;
      queueMicrotask(() => handlers.onUp());
      return { close: () => {} };
    },
    saved: { get: () => null, set: () => {} },
    manual: () => "",
    now: clk.now,
    wait: clk.wait,
    timers: { set: clk.setTimer, clear: clk.clearTimer },
    onState: (s, d) => states.push([s, d]),
  });

  finder.start();
  await clk.advance(10);
  assert.equal(states.at(-1)[0], "connected");
  handle.onDown();
  await clk.advance(10);
  assert.ok(states.some(([s]) => s === "looking"));
  await clk.advance(10_000);
  assert.equal(attempt, 2);
  assert.equal(states.at(-1)[0], "connected");
  finder.stop();
});

test("watchdog closes a silent connection after 45s", async () => {
  const clk = fakeClock();
  let closed = 0;
  let down = 0;
  const finder = createFinder({
    find: async () => ({ host: "192.168.1.50", port: 4466 }),
    open: (_url, handlers) => {
      queueMicrotask(() => handlers.onUp());
      return {
        close: () => {
          closed++;
          handlers.onDown();
        },
      };
    },
    saved: { get: () => null, set: () => {} },
    manual: () => "",
    now: clk.now,
    wait: clk.wait,
    timers: { set: clk.setTimer, clear: clk.clearTimer },
    onState: (s) => { if (s === "looking") down++; },
  });

  finder.start();
  await clk.advance(45_010);
  assert.ok(closed >= 1);
  assert.ok(down >= 1);
  finder.stop();
});
