import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import {
  drawCat, catBounds, COSMETICS, COAT_COLOURS, COAT_KEYS, SLOTS, isKnownKey, CAT_W, CAT_H,
} from "../src/pixel-cats.js";

/** A fake canvas context that records every fillRect with the fillStyle at that moment. */
const recorder = () => {
  const calls = [];
  const ctx = { fillStyle: "", fillRect(x, y, w, h) { calls.push([x, y, w, h, this.fillStyle]); } };
  return { ctx, calls };
};
/** Final colour per pixel (later paints win), as a Map "x,y" -> colour. */
const paint = (calls) => {
  const m = new Map();
  for (const [x, y, w, h, c] of calls) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) m.set(`${x + i},${y + j}`, c);
  return m;
};
const draw = (look, o) => { const r = recorder(); drawCat(r.ctx, 0, 0, look, o); return r.calls; };
const hash = (calls) => crypto.createHash("sha256").update(JSON.stringify(calls)).digest("hex").slice(0, 16);

test("existing cats paint exactly the pixels sprites.mjs painted before the move", () => {
  // count + hash of [x, y, w, h, fillStyle] taken from the old implementation
  const cases = [
    ["ginger", {}, 166, "849553057a949855"],
    ["ginger", { apron: true }, 206, "0f1e35d8b5ecbd6f"],
    ["tabby", { flip: true, blink: true }, 166, "3fa6bb7402506a38"],
    ["calico", { rows: 9 }, 101, "055f23aa894f71ef"],
  ];
  for (const [look, o, n, h] of cases) {
    const calls = draw(look, o);
    assert.equal(calls.length, n, `${look} ${JSON.stringify(o)} count`);
    assert.equal(hash(calls), h, `${look} ${JSON.stringify(o)} hash`);
  }
});

test("a look object with only a coat paints the same as the coat name", () => {
  assert.deepEqual(draw({ coat: "tabby" }), draw("tabby"));
});

test("the 8 coats and the 5 slots", () => {
  assert.equal(COAT_KEYS.length, 8);
  assert.deepEqual(COAT_KEYS, Object.keys(COAT_COLOURS));
  assert.deepEqual(SLOTS, ["coat", "hat", "face", "neck", "held"]);
  assert.equal(CAT_W, 14);
  assert.equal(CAT_H, 16);
});

test("there are 14 non-coat cosmetics (the 18 for sale include 4 shop coats), each in one of the four non-coat slots, with rectangular rows", () => {
  const keys = Object.keys(COSMETICS);
  assert.equal(keys.length, 14);
  for (const k of keys) {
    const c = COSMETICS[k];
    assert.ok(["hat", "face", "neck", "held"].includes(c.slot), `${k} slot`);
    assert.ok(Number.isInteger(c.dx) && Number.isInteger(c.dy), `${k} offset`);
    assert.ok(c.rows.length > 0, `${k} has rows`);
    const w = c.rows[0].length;
    for (const row of c.rows) assert.equal(row.length, w, `${k} rectangular`);
    for (const row of c.rows) for (const ch of row) if (ch !== ".") assert.ok(c.colours[ch], `${k} colour for '${ch}'`);
  }
  const bySlot = (s) => keys.filter((k) => COSMETICS[k].slot === s).sort();
  assert.deepEqual(bySlot("hat"), ["beanie", "crown", "flower-crown", "party-hat", "visor"]);
  assert.deepEqual(bySlot("face"), ["blush", "round-glasses", "sunnies"]);
  assert.deepEqual(bySlot("neck"), ["bandana", "bell-collar", "bow-tie"]);
  assert.deepEqual(bySlot("held"), ["croissant", "fish", "kennko-cup"]);
});

test("isKnownKey checks the key against its slot", () => {
  assert.equal(isKnownKey("coat", "ginger"), true);
  assert.equal(isKnownKey("coat", "beanie"), false);
  assert.equal(isKnownKey("hat", "beanie"), true);
  assert.equal(isKnownKey("face", "beanie"), false);
  assert.equal(isKnownKey("hat", "constructor"), false);
  assert.equal(isKnownKey("nope", "beanie"), false);
});

for (const [key, def] of Object.entries(COSMETICS)) {
  test(`cosmetic ${key} changes the picture and stays inside catBounds`, () => {
    const look = { coat: "ginger", [def.slot]: key };
    const base = paint(draw({ coat: "ginger" }));
    const withIt = paint(draw(look));
    const changed = [...withIt].filter(([p, c]) => base.get(p) !== c);
    assert.ok(changed.length >= 1, "adds at least one pixel");
    const b = catBounds(look);
    for (const p of withIt.keys()) {
      const [x, y] = p.split(",").map(Number);
      assert.ok(x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1, `${p} within ${JSON.stringify(b)}`);
    }
  });

  test(`cosmetic ${key} mirrors with flip around the centre column`, () => {
    const look = { coat: "ginger", [def.slot]: key };
    const a = paint(draw(look));
    const f = paint(draw(look, { flip: true }));
    assert.equal(f.size, a.size);
    for (const [p, c] of a) {
      const [x, y] = p.split(",").map(Number);
      assert.equal(f.get(`${CAT_W - 1 - x},${y}`), c, `${p} mirrors`);
    }
  });
}

test("catBounds of a bare cat is the cat; hats rise above row 0 and held items pass column 13", () => {
  assert.deepEqual(catBounds("ginger"), { x0: 0, y0: 0, x1: 13, y1: 15 });
  assert.ok(catBounds({ coat: "ginger", hat: "crown" }).y0 < 0);
  assert.ok(catBounds({ coat: "ginger", held: "fish" }).x1 > 13);
});

test("an unknown key paints the same pixels as none (newer catalogue, older wall)", () => {
  assert.deepEqual(draw({ coat: "ginger", hat: "wizard-hat" }), draw({ coat: "ginger" }));
  assert.deepEqual(draw({ coat: "ginger", face: "monocle", neck: "x", held: "y" }), draw({ coat: "ginger" }));
  assert.deepEqual(catBounds({ coat: "ginger", hat: "wizard-hat" }), catBounds("ginger"));
});

test("a key in the wrong slot is skipped", () => {
  assert.deepEqual(draw({ coat: "ginger", face: "beanie" }), draw({ coat: "ginger" }));
});

test("draw order is body, neck, face, hat, held", () => {
  const all = draw({ coat: "ginger", held: "fish", hat: "beanie", face: "blush", neck: "bow-tie" });
  const bodyLen = draw("ginger").length;
  const alone = (slot, key) => draw({ coat: "ginger", [slot]: key }).slice(bodyLen);
  const expected = [alone("neck", "bow-tie"), alone("face", "blush"), alone("hat", "beanie"), alone("held", "fish")].flat();
  assert.deepEqual(all.slice(bodyLen), expected);
});

test("rows clips overlays to the drawn rows", () => {
  const look = { coat: "ginger", hat: "beanie", neck: "bandana", held: "kennko-cup" };
  const clipped = draw(look, { rows: 9 });
  for (const [, y] of clipped) assert.ok(y < 9, `row ${y}`);
  assert.ok(clipped.some(([, y]) => y < 0), "the hat above row 0 is still drawn");
});

test("the module has no import statement and touches no document or window", () => {
  const src = fs.readFileSync(new URL("../src/pixel-cats.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /^\s*import[\s{(*"']/m);
  assert.doesNotMatch(src, /\bdocument\b|\bwindow\b/);
});
