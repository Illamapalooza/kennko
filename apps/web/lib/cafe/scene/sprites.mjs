// Pixel art for the Kennko wall, drawn from character maps (cup, glyphs, text; the cat is in ./cats.mjs). No DOM access at import time.

// The cat itself (the 14 x 16 sprite, coats, cosmetics and the loaf) is the shared module in ./cats.mjs, a copy of
// packages/cats/src/pixel-cats.js. Never edit the copy: run `npm run export-wall -w @kennko/cats`.
import { INK, BLUE, AMBER } from "./cats.mjs";
export { INK, BLUE, AMBER, CAT_FRONT, CAT_W, CAT_H, COAT_COLOURS, COAT_KEYS, SLOTS, COSMETICS, isKnownKey, drawCat, catBounds, drawLoaf } from "./cats.mjs";

/** A takeaway cup, 4 x 6, top-left at (x, y). */
export function drawCup(ctx, x, y) {
  ctx.fillStyle = INK; ctx.fillRect(x, y, 4, 6);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(x, y, 4, 1); ctx.fillRect(x + 1, y + 1, 2, 4);
  ctx.fillStyle = BLUE; ctx.fillRect(x + 1, y + 2, 2, 2);
}

// Pixel glyphs, 5 rows tall. Most are 3 wide; M and N need more room to read.
const g3 = (bits) => [0, 3, 6, 9, 12].map((i) => bits.slice(i, i + 3));
export const GLYPHS = {
  0: g3("111101101101111"), 1: g3("010110010010111"), 2: g3("111001111100111"), 3: g3("111001111001111"),
  4: g3("101101111001001"), 5: g3("111100111001111"), 6: g3("111100111101111"), 7: g3("111001010010010"),
  8: g3("111101111101111"), 9: g3("111101111001111"),
  K: g3("101101110101101"), E: g3("111100110100111"), O: g3("111101101101111"), U: g3("101101101101111"),
  P: g3("111101111100100"), I: g3("111010010010111"), C: g3("111100100100111"), Z: g3("111001010100111"),
  F: g3("111100110100100"), " ": ["00", "00", "00", "00", "00"],
  M: ["10001", "11011", "10101", "10001", "10001"],
  N: ["1001", "1101", "1011", "1001", "1001"],
};
const glyph = (ch) => GLYPHS[ch] ?? GLYPHS[" "];

/** Draw text in the pixel font. Returns the width drawn. */
export function drawText(ctx, text, x, y, colour, scale = 1) {
  ctx.fillStyle = colour;
  let cx = x;
  for (const ch of String(text)) {
    const rows = glyph(ch);
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) if (row[c] === "1") ctx.fillRect(cx + c * scale, y + r * scale, scale, scale);
    });
    cx += (rows[0].length + 1) * scale;
  }
  return cx - x - scale;
}

export function textWidth(text, scale = 1) {
  let w = 0;
  for (const ch of String(text)) w += (glyph(ch)[0].length + 1) * scale;
  return Math.max(0, w - scale);
}
