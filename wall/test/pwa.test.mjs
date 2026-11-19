import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), "utf8");
const manifest = (f) => JSON.parse(read(f));

test("wall manifest is a fullscreen blue app", () => {
  const m = manifest("manifest.webmanifest");
  assert.equal(m.name, "Kennko Wall");
  assert.equal(m.start_url, "/");
  assert.equal(m.display, "fullscreen");
  assert.equal(m.theme_color, "#0055ff");
});

test("pad manifest installs the order pad at /pad", () => {
  const m = manifest("pad.webmanifest");
  assert.equal(m.name, "Kennko Pad");
  assert.equal(m.start_url, "/pad");
  assert.equal(m.display, "standalone");
  assert.equal(m.theme_color, "#0055ff");
});

test("every manifest icon exists, including a maskable one", () => {
  for (const f of ["manifest.webmanifest", "pad.webmanifest"]) {
    const { icons } = manifest(f);
    assert.ok(icons.some((i) => i.purpose === "maskable"), `${f} has a maskable icon`);
    for (const icon of icons) assert.ok(fs.existsSync(path.join(PUBLIC, icon.src)), `${icon.src} exists`);
  }
});

test("the pages link their own manifest and the iOS icon", () => {
  assert.match(read("index.html"), /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(read("pad.html"), /<link rel="manifest" href="\/pad\.webmanifest">/);
  for (const f of ["index.html", "pad.html"]) assert.match(read(f), /rel="apple-touch-icon"/);
});

test("both pages register the worker", () => {
  assert.match(read("wall.mjs"), /serviceWorker\.register\("\/sw\.js"/);
  assert.match(read("pad.js"), /serviceWorker\.register\("\/sw\.js"/);
});

test("the worker keeps the scene files but never the API or event streams", () => {
  const sw = read("sw.js");
  assert.match(sw, /\/api\//);
  assert.match(sw, /pathname\.startsWith\("\/api\/"\)\) return/);
  assert.match(sw, /request\.method !== "GET"/);
});

test("the server sends manifests with the right content type", () => {
  const server = fs.readFileSync(path.join(PUBLIC, "..", "server.mjs"), "utf8");
  assert.match(server, /"\.webmanifest": "application\/manifest\+json/);
});
