// Original pixel art for the Kennko wall, drawn from character maps. No DOM access at import time.

export const INK = "#1a2340";
export const BLUE = "#0055ff";
export const AMBER = "#ffb830";

// 14 x 16. o outline, f fur, d stripes, c/k head patches, w muzzle, p pink, e eyes, a chest (apron on a barista).
export const CAT_FRONT = [
  ".oo.......oo..",
  "ofpo.....opfo.",
  "offfooooofffo.",
  "occfdfdfdfkko.",
  "occcfffffkkko.",
  "offefffffeffo.",
  "offefffffeffo.",
  "offfwwpwwfffo.",
  ".offfwwwfffo..",
  "..ooooooooo...",
  "..offaaaffo...",
  ".offaaaaaffo..",
  ".offaaaaaffo.o",
  ".offaaaaaffoo.",
  "..ofoo.oofo...",
  "..oo....oo....",
];
export const CAT_W = CAT_FRONT[0].length;
export const CAT_H = CAT_FRONT.length;

const coat = (f, o) => ({ o: INK, f, d: f, c: f, k: f, w: "#ffffff", p: "#ff9db0", e: INK, a: "#ffffff", ...o });
export const COAT_COLOURS = {
  ginger: coat("#f2a03c", { d: "#c9701c", w: "#fff3df", a: "#fff3df" }),
  tuxedo: coat("#343846", { e: "#ffe066", a: "#ffffff" }),
  tabby: coat("#a4a9b8", { d: "#6f7489", a: "#e4e7ef", w: "#f3f4f8" }),
  white: coat("#fbfbfd", { d: "#fbfbfd", a: "#eceef5", w: "#ffffff", e: "#2a7fd6" }),
  calico: coat("#fbf6ea", { c: "#f09a3e", k: "#4a4350", a: "#fbf6ea" }),
  siamese: coat("#f1e2c9", { c: "#7a5a48", k: "#7a5a48", w: "#7a5a48", p: "#5c4034", e: "#2a7fd6", a: "#f1e2c9" }),
  black: coat("#3b3d4d", { e: "#9be36a", w: "#3b3d4d", a: "#3b3d4d", p: "#7a6a80" }),
  cream: coat("#f6dba8", { d: "#e2bb78", w: "#fffaf0", a: "#fffaf0" }),
};

/**
 * Draw a standing cat with its top-left at (x, y).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{flip?: boolean, apron?: boolean, blink?: boolean, rows?: number}} [o] rows: draw only the top N rows
 */
export function drawCat(ctx, x, y, coatName, o = {}) {
  const pal = COAT_COLOURS[coatName] ?? COAT_COLOURS.ginger;
  const rows = Math.min(o.rows ?? CAT_H, CAT_H);
  for (let r = 0; r < rows; r++) {
    const line = CAT_FRONT[r];
    for (let c = 0; c < CAT_W; c++) {
      let ch = line[c];
      if (ch === ".") continue;
      if (ch === "e" && o.blink) ch = r === 6 ? "o" : "f";
      ctx.fillStyle = ch === "a" && o.apron ? BLUE : pal[ch];
      ctx.fillRect(x + (o.flip ? CAT_W - 1 - c : c), y + r, 1, 1);
    }
  }
  if (o.apron) {
    // barista visor and apron bib
    ctx.fillStyle = BLUE;
    ctx.fillRect(x + (o.flip ? 5 : 4), y + 2, 5, 1);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + (o.flip ? 7 : 6), y + 11, 1, 1);
  }
}

/** A cat curled up asleep; (x, y) is its top-left, about 19 x 9. */
export function drawLoaf(ctx, x, y, coatName, breathe = 0) {
  const pal = COAT_COLOURS[coatName] ?? COAT_COLOURS.ginger;
  const R = (c, a, b, w, h) => { ctx.fillStyle = c; ctx.fillRect(x + a, y + b, w, h); };
  R(INK, 4, 2 - breathe, 13, 7 + breathe); R(INK, 16, 5, 3, 4);
  R(pal.f, 5, 3 - breathe, 11, 5 + breathe); R(pal.d, 8, 3 - breathe, 1, 2); R(pal.d, 11, 3 - breathe, 1, 2);
  R(pal.f, 16, 6, 2, 2);
  R(INK, 0, 2, 8, 7); R(INK, 0, 0, 3, 2); R(INK, 5, 0, 3, 2);
  R(pal.f, 1, 3, 6, 5); R(pal.c === pal.f ? pal.f : pal.c, 1, 1, 1, 2); R(pal.k === pal.f ? pal.f : pal.k, 6, 1, 1, 2);
  R(pal.p, 1, 1, 1, 1); R(pal.p, 6, 1, 1, 1);
  R(pal.e === INK ? INK : "#22263a", 2, 5, 2, 1); R(pal.e === INK ? INK : "#22263a", 5, 5, 2, 1);
  R(pal.p, 4, 6, 1, 1);
}

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
