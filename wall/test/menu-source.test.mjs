import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { FALLBACK_DRINKS, readMenu, loadCachedMenu, saveCachedMenu, namesOf, fetchTillMenu } from "../menu-source.mjs";

const good = [
  { category: "Classics", items: [{ name: "Latte", star: false }, { name: "Spanish Latte", star: true }] },
  { category: "Barista's Choice", items: [{ name: "Egg Coffee", star: true }] },
];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "wall-menu-"));

test("four generic names for a wall that never met a till", () => {
  assert.deepEqual(FALLBACK_DRINKS, ["Latte", "Americano", "Mocha", "Caramel Macchiato"]);
});

test("readMenu accepts the till's shape", () => {
  assert.deepEqual(readMenu(good), good);
  assert.deepEqual(readMenu([]), []);
});

test("readMenu rejects what is not the till's shape", () => {
  assert.equal(readMenu("menu"), null);
  assert.equal(readMenu(null), null);
  assert.equal(readMenu({}), null);
  assert.equal(readMenu(Array.from({ length: 31 }, (_, i) => ({ category: `C${i}`, items: [{ name: "x", star: false }] }))), null);
  assert.equal(readMenu([{ category: "A", items: [{ name: 5, star: false }] }]), null);
  assert.equal(readMenu([{ category: "A", items: [{ name: "", star: false }] }]), null);
  assert.equal(readMenu([{ category: "A", items: [{ name: "x", star: "yes" }] }]), null);
  assert.equal(readMenu([{ category: "A", items: Array.from({ length: 201 }, (_, i) => ({ name: `d${i}`, star: false })) }]), null);
  assert.equal(readMenu([{ category: "A", items: "nope" }]), null);
});

test("readMenu accepts 200 items across categories and cuts long names to 40", () => {
  const many = Array.from({ length: 10 }, (_, c) => ({ category: `C${c}`, items: Array.from({ length: 20 }, (_, i) => ({ name: `d${c}-${i}`, star: false })) }));
  assert.equal(readMenu(many).length, 10);
  const cut = readMenu([{ category: "A", items: [{ name: "x".repeat(60), star: false }] }]);
  assert.equal(cut[0].items[0].name.length, 40);
});

test("readMenu keeps only name and star: a price on the wire is dropped", () => {
  const m = readMenu([{ category: "A", items: [{ name: "x", star: true, price: 100, priceCentavos: 1 }] }]);
  assert.deepEqual(m, [{ category: "A", items: [{ name: "x", star: true }] }]);
});

test("save then load round-trips, and never leaves a .tmp behind", () => {
  const dir = tmp();
  const file = path.join(dir, "data", "menu.json");
  saveCachedMenu(file, good);
  assert.deepEqual(loadCachedMenu(file), good);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["menu.json"]);
});

test("a missing or corrupt cache loads as null and saving to a bad place does not throw", () => {
  const dir = tmp();
  assert.equal(loadCachedMenu(path.join(dir, "none.json")), null);
  const bad = path.join(dir, "bad.json");
  fs.writeFileSync(bad, "{not json");
  assert.equal(loadCachedMenu(bad), null);
  fs.writeFileSync(path.join(dir, "file"), "x");
  assert.doesNotThrow(() => saveCachedMenu(path.join(dir, "file", "menu.json"), good));
});

test("namesOf collects every drink name", () => {
  assert.deepEqual(namesOf(good), new Set(["Latte", "Spanish Latte", "Egg Coffee"]));
  assert.deepEqual(namesOf([]), new Set());
});

test("fetchTillMenu reads /api/wall/menu from a till", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/wall/menu") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ menu: good })); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const got = await fetchTillMenu(`http://127.0.0.1:${server.address().port}/`);
    assert.deepEqual(got, good);
  } finally { server.close(); }
});

test("fetchTillMenu: a bad answer or a closed port is null, within the timeout", async () => {
  const server = http.createServer((req, res) => { res.writeHead(200); res.end("<html>"); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try { assert.equal(await fetchTillMenu(`http://127.0.0.1:${port}`), null); } finally { await new Promise((r) => server.close(r)); }
  const t = Date.now();
  assert.equal(await fetchTillMenu(`http://127.0.0.1:${port}`, 500), null);
  assert.ok(Date.now() - t < 1500);
});

test("fetchTillMenu gives up on a till that never answers", async () => {
  const server = http.createServer(() => {});
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const t = Date.now();
  try { assert.equal(await fetchTillMenu(`http://127.0.0.1:${server.address().port}`, 300), null); } finally { server.closeAllConnections?.(); server.close(); }
  assert.ok(Date.now() - t < 1500);
});
