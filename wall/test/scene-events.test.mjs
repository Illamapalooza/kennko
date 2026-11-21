import test from "node:test";
import assert from "node:assert/strict";
import { sceneEvents } from "../public/scene/logic.mjs";

const order = (id, status) => ({ id, status });
const visitor = (key) => ({ key });

test("first frame gives []", () => {
  assert.deepEqual(sceneEvents(null, { orders: [order(1, "queued")], visitors: [visitor("v1")] }), []);
});

test("a new queued order gives ['join']", () => {
  const prev = { orders: [], visitors: [] };
  const next = { orders: [order(1, "queued")], visitors: [] };
  assert.deepEqual(sceneEvents(prev, next), ["join"]);
});

test("queued -> preparing gives ['preparing']", () => {
  const prev = { orders: [order(1, "queued")], visitors: [] };
  const next = { orders: [order(1, "preparing")], visitors: [] };
  assert.deepEqual(sceneEvents(prev, next), ["preparing"]);
});

test("-> serving gives ['ready']", () => {
  const prev = { orders: [order(1, "preparing")], visitors: [] };
  const next = { orders: [order(1, "serving")], visitors: [] };
  assert.deepEqual(sceneEvents(prev, next), ["ready"]);
});

test("a new visitor key gives ['catIn']", () => {
  const prev = { orders: [], visitors: [visitor("v1")] };
  const next = { orders: [], visitors: [visitor("v1"), visitor("v2")] };
  assert.deepEqual(sceneEvents(prev, next), ["catIn"]);
});

test("a visitor gone gives ['catOut']", () => {
  const prev = { orders: [], visitors: [visitor("v1"), visitor("v2")] };
  const next = { orders: [], visitors: [visitor("v1")] };
  assert.deepEqual(sceneEvents(prev, next), ["catOut"]);
});

test("three new orders give ['join'] once", () => {
  const prev = { orders: [], visitors: [] };
  const next = { orders: [order(1, "queued"), order(2, "queued"), order(3, "queued")], visitors: [] };
  assert.deepEqual(sceneEvents(prev, next), ["join"]);
});

test("a voided order gives []", () => {
  const prev = { orders: [order(1, "queued")], visitors: [] };
  const next = { orders: [order(1, "cancelled")], visitors: [] };
  assert.deepEqual(sceneEvents(prev, next), []);
});
