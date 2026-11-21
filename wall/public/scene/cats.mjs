// The Kennko pixel cat and its cosmetics, drawn from character maps. Plain JavaScript: no imports, no DOM access.
// The website imports this file; the wall carries a byte-identical copy (wall/public/scene/cats.mjs, written by
// `npm run export-wall -w @kennko/cats`, never edited by hand). Types live beside it in pixel-cats.d.ts.

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

export const SLOTS = ["coat", "hat", "face", "neck", "held"];
export const COAT_KEYS = Object.keys(COAT_COLOURS);

// Cosmetic overlays. rows: character map, "." is clear; colours: char -> colour; (dx, dy) is the top-left against the
// cat's top-left. Hats rise above row 0 (dy < 0) and held items reach past column 13.
const WHITE = "#ffffff";
export const COSMETICS = {
  // hats
  beanie: { slot: "hat", dx: 1, dy: -1, colours: { o: INK, a: AMBER, b: BLUE, w: WHITE },
    rows: ["....oaao....", "..oobbbboo..", ".obbbbbbbbo.", "owwwwwwwwwwo"] },
  "party-hat": { slot: "hat", dx: 4, dy: -3, colours: { o: INK, a: AMBER, b: BLUE },
    rows: ["..a..", ".obo.", ".oao.", "obbbo", "ooooo"] },
  visor: { slot: "hat", dx: 1, dy: 2, colours: { b: BLUE, o: INK },
    rows: ["bbbbbbbbbbb", ".ooooooooo."] },
  "flower-crown": { slot: "hat", dx: 1, dy: 1, colours: { g: "#3fae5a", p: "#ff6f91", a: AMBER, w: WHITE },
    rows: [".p...a...p..", "gpgagwgagpg."] },
  crown: { slot: "hat", dx: 2, dy: -1, colours: { a: AMBER, d: "#c77d00", r: "#e5384f" },
    rows: ["a...aa...a", "aa.aaaa.aa", "aaaaaaaaaa", "dddrddrddd"] },
  // face
  blush: { slot: "face", dx: 2, dy: 7, colours: { p: "#ff8fa3" },
    rows: ["pp.....pp"] },
  "round-glasses": { slot: "face", dx: 2, dy: 4, colours: { b: BLUE },
    rows: ["bbb...bbb", "b.bbbbb.b", "b.b...b.b", "bbb...bbb"] },
  sunnies: { slot: "face", dx: 2, dy: 5, colours: { k: "#10162f", w: WHITE },
    rows: ["kwkkkkkwk", ".kkk.kkk."] },
  // neck
  bandana: { slot: "neck", dx: 2, dy: 9, colours: { a: AMBER },
    rows: ["aaaaaaaaa", ".aaaaaaa.", "..aaaaa..", "...aaa...", "....a...."] },
  "bow-tie": { slot: "neck", dx: 3, dy: 9, colours: { b: BLUE, o: INK },
    rows: ["bbbobbb", ".bbobb."] },
  "bell-collar": { slot: "neck", dx: 2, dy: 9, colours: { b: BLUE, a: AMBER, d: "#c77d00" },
    rows: ["bbbbbbbbb", "....a....", "....d...."] },
  // held: in the paw on the cat's right
  "kennko-cup": { slot: "held", dx: 11, dy: 9, colours: { o: INK, w: WHITE, b: BLUE },
    rows: ["wwww", "owwo", "obbo", "obbo", "owwo", "oooo"] },
  croissant: { slot: "held", dx: 10, dy: 10, colours: { o: INK, t: "#d98a2b", u: "#f2b04c" },
    rows: [".ooo.", "outuo", "otuto", ".ooo."] },
  fish: { slot: "held", dx: 9, dy: 11, colours: { o: INK, e: WHITE, l: "#7fb2ff" },
    rows: [".oooo.oo", "oellllo.", ".oooo.oo"] },
};

const own = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);

/** Is `key` a cosmetic (or, for the coat slot, a coat) this module can draw in that slot? */
export function isKnownKey(slot, key) {
  if (slot === "coat") return own(COAT_COLOURS, key);
  return own(COSMETICS, key) && COSMETICS[key].slot === slot;
}

const normalise = (look) => (typeof look === "string" ? { coat: look } : look ?? {});
// Overlays in draw order, skipping unknown keys (a newer catalogue on an older wall draws the cat without them).
const overlaysOf = (look) =>
  ["neck", "face", "hat", "held"].filter((s) => isKnownKey(s, look[s])).map((s) => COSMETICS[look[s]]);

/**
 * Draw a standing cat with its top-left at (x, y).
 * @param {CanvasRenderingContext2D} ctx
 * @param look a coat name, or { coat, hat?, face?, neck?, held? }
 * @param {{flip?: boolean, apron?: boolean, blink?: boolean, rows?: number}} [o] rows: draw only the top N rows
 */
export function drawCat(ctx, x, y, look, o = {}) {
  const l = normalise(look);
  const pal = COAT_COLOURS[l.coat] ?? COAT_COLOURS.ginger;
  const rows = Math.min(o.rows ?? CAT_H, CAT_H);
  const px = (c) => x + (o.flip ? CAT_W - 1 - c : c);
  for (let r = 0; r < rows; r++) {
    const line = CAT_FRONT[r];
    for (let c = 0; c < CAT_W; c++) {
      let ch = line[c];
      if (ch === ".") continue;
      if (ch === "e" && o.blink) ch = r === 6 ? "o" : "f";
      ctx.fillStyle = ch === "a" && o.apron ? BLUE : pal[ch];
      ctx.fillRect(px(c), y + r, 1, 1);
    }
  }
  if (o.apron) {
    // barista visor and apron bib
    ctx.fillStyle = BLUE;
    ctx.fillRect(x + (o.flip ? 5 : 4), y + 2, 5, 1);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + (o.flip ? 7 : 6), y + 11, 1, 1);
  }
  for (const cos of overlaysOf(l)) {
    cos.rows.forEach((line, r) => {
      const row = cos.dy + r;
      if (row >= rows) return;
      for (let c = 0; c < line.length; c++) {
        if (line[c] === ".") continue;
        ctx.fillStyle = cos.colours[line[c]];
        ctx.fillRect(px(cos.dx + c), y + row, 1, 1);
      }
    });
  }
}

/** The box (in cat pixels, inclusive) around the cat and its overlays: { x0, y0, x1, y1 }. Not flipped. */
export function catBounds(look) {
  const b = { x0: 0, y0: 0, x1: CAT_W - 1, y1: CAT_H - 1 };
  for (const cos of overlaysOf(normalise(look))) {
    b.x0 = Math.min(b.x0, cos.dx);
    b.y0 = Math.min(b.y0, cos.dy);
    b.x1 = Math.max(b.x1, cos.dx + cos.rows[0].length - 1);
    b.y1 = Math.max(b.y1, cos.dy + cos.rows.length - 1);
  }
  return b;
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
