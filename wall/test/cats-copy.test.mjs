import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = new URL("../../packages/cats/src/pixel-cats.js", import.meta.url);
const copy = new URL("../public/scene/cats.mjs", import.meta.url);

// The wall ships alone (zero dependencies), so it carries a copy of the shared art module.
test("wall/public/scene/cats.mjs is a byte-identical copy of packages/cats/src/pixel-cats.js", (t) => {
  if (!fs.existsSync(source)) return t.skip("packages/cats is not in this checkout (wall deployed alone)");
  assert.ok(fs.existsSync(copy), "cats.mjs is missing: run `npm run export-wall -w @kennko/cats`");
  assert.ok(
    fs.readFileSync(source).equals(fs.readFileSync(copy)),
    "wall/public/scene/cats.mjs is out of date: run `npm run export-wall -w @kennko/cats`",
  );
});
