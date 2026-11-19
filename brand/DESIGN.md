# Kennko Design Guidelines

**Status: v2, 2026-11-20.** Adds the retro sticker layer from the food-menu flyers (`assets/food-menu/`). The tokens
are wired into the website, the POS and the wall (commit `6dfab31`).

How Kennko looks on every screen and on paper: the website, the POS, the order pad, the wall, menus and posters.
`BRIEF.md` says who the brand is; this says how to build with it. The values live in `packages/tokens/tokens.css`.
Use the variables, never a raw hex code or pixel radius.

## The look in one paragraph

Electric blue and white, bold and rounded, a little playful. Big uppercase headings, pill-shaped buttons, soft
blue-tinted shadows, plenty of white space. Amber appears rarely, so it means something when it does. On marketing
surfaces a second, louder layer is allowed: **retro stickers**. That means blue panels with thick ink outlines, warm
cream paper with grid, stripe or gingham patterns, cartoon food with faces, googly eyes and smileys. There is no dark
theme, no black and no grey.

## Two layers

| Layer | Where | Feel |
|---|---|---|
| **Core** | Website admin, printed receipts | Calm, fast, blue and white. Soft shadows, no outlines, no patterns. |
| **Retro sticker** | The whole public website (landing, ordering, account, order tracking), the till, the wall, printed menus and posters, social graphics | Loud and fun. Ink outlines, hard shadows, cream paper, patterns, perched cats. |

Website admin stays core. **The till wears the sticker layer too** (Julius, 2026-11-20), tuned for the counter: tap
targets and contrast are unchanged, presses give instant feedback, and the cats stay out of the selling area (they
appear on sign-in, loading, the empty cart and the paid screen). The cats are shared through `packages/cats`. **Customer-facing pages wear the sticker layer,
ordering included** (Julius, 2026-11-20), with one guard: form controls (inputs, selects, the location pin) stay plain
and high-contrast inside sticker panels, so checkout is as easy to fill in as before.

**The website's landing page is fully sticker layer** (`apps/web/app/landing.css`, scoped under `.landing`): one
tiled grid paper behind everything, blue sticker boards, cream section labels, a ticker strip under the hero.
The ordering pages share the look through the "Sticker theme" block at the end of `apps/web/app/order/order.css`;
`/admin` stays core. The cat perch rules (`.perch-*`) live in `apps/web/app/globals.css` so every page can use them.

## Colour

### Core

| Token | Value | Use |
|---|---|---|
| `--blue` | `#0055ff` | Primary. Main buttons, headings, links, full blue sections, sticker panels. |
| `--blue-dark` | `#003fc0` | Hover and pressed states of blue. |
| `--blue-soft` | `#e8efff` | Chips, selected rows, quiet buttons. |
| `--blue-wash` | `#f3f6ff` | App background behind white cards. |
| `--white` | `#ffffff` | Cards, text on blue. |
| `--amber` | `#ffb830` | Accent: promo badges, bestseller stars, focus ring. |
| `--amber-soft` | `#fff3d6` | Fill behind an amber badge. |
| `--ink` | `#0d1b3d` | Body text, and every outline in the sticker layer. |
| `--ink-soft` | `#55628a` | Secondary text, labels, hints. |
| `--line` | `#d9e3fb` | Borders and dividers. |
| `--red` / `--red-soft` | `#d92d3a` / `#ffe9eb` | Errors, voids, cancel, negative amounts. |
| `--green` / `--green-soft` | `#0f9d63` / `#e2f7ee` | Success, available, positive amounts. |

### Retro sticker

Sampled from the flyers, then adjusted to the core set where the two disagree (see "Print versus screen").

| Token | Value | Use |
|---|---|---|
| `--cream` | `#fff5f0` | Warm paper behind sticker panels, and the image cell of a sticker card. |
| `--peach` | `#ffe6dc` | Text cell of a sticker card, where the name, options and price sit. |
| `--sun` | `#ffcc00` | Smiley and sticker yellow. Illustration only. |
| `--plate-pink` | `#f77293` | Food plates and illustration fills. |
| `--plate-orange` | `#eb5d1b` | Food plates and illustration fills. |
| `--plate-yellow` | `#fdc631` | Food plates and illustration fills. |
| `--sky` | `#90bcf6` | Stripe pattern. |
| `--gingham-paper` | `#fff6d1` | Paper under the gingham pattern (its bands are a translucent yellow). |
| `--checker` | `#4b85cd` | Checker strip along the foot of a gingham page. |

### Rules

- A core screen is either **white with blue** or **blue with white**. A sticker section is **blue panels on cream
  paper**. Never dark.
- **Amber is an accent, not a colour scheme.** One or two amber things per screen at most. The sticker yellows
  (`--sun`, `--plate-yellow`) are part of illustrations and do not count against this.
- **Amber and yellow are never text on white or cream**; they are too faint to read. Put `--ink` text on them.
- Text on blue is white (or cream with an ink keyline at display sizes). Text on white, cream or peach is `--ink`,
  or `--blue` for headings and links.
- **Plate colours are for illustrations and decoration only.** They never mean status, never fill a button, and
  are never text.
- Red and green carry meaning only. Never use them to decorate. Do not confuse `--plate-orange` with `--red`:
  orange never signals an error.
- Never show status by colour alone; pair it with a word or an icon.

### Print versus screen

The flyers render the panel blue as `#1e46a4` and outlines as pure black. Both come from the print and Canva
export, not from a new brand colour. On screens, panels are `--blue` and outlines are `--ink`. When briefing a
printer or a designer, give `#0055ff` and ask for a proof; if it prints too bright on uncoated stock, approve a
deeper blue for print only, and record it here.

## Type

One family on screens: **Nunito** (`--font`), a rounded sans-serif that matches the bubble logo. The website loads
it through `next/font`, the POS through `@fontsource-variable/nunito`.

| Role | Size token | Weight | Style |
|---|---|---|---|
| Hero (marketing only) | `--text-hero` | 900 | Uppercase |
| Section heading (marketing) | `--text-display` | 900 | Uppercase; may use `.k-outlined` on blue |
| Sticker price | `--text-price` | 900 | Tabular figures, `--ink` on `--peach` |
| Page title (apps) | `--text-xl` | 900 | Uppercase, blue |
| Section title (apps) | `--text-lg` | 900 | Uppercase |
| Card title, lead text | `--text-md` | 800 | Sentence case; uppercase on sticker cards |
| Body | `--text-base` | 600 | Sentence case |
| Label, hint, badge | `--text-sm` | 700 to 800 | Small labels uppercase with `--tracking-label` |
| Fine print | `--text-xs` | 600 | Sentence case |

- Headings are uppercase and heavy, with `--leading-tight`. Body text is never uppercase.
- **Outlined headings** (`.k-outlined`: cream fill, ink keyline, a small ink drop) are for display sizes on blue
  sticker panels only. Never on body text, never below `--text-lg`, never on white.
- Keep body text at 16px or larger. On shop tablets the base is 17px.
- Prices use tabular figures (`font-variant-numeric: tabular-nums`) so columns line up. Format with `formatPesos()`
  from `@kennko/core`. Use the ₱ sign before the number (`₱60`), not the flyer's trailing sign (`60₱`).
- The logo is artwork, not a font. Never retype "KENNKO" in Nunito as a stand-in for the logo. "KENNKO'S FOOD
  MENU" style headlines are fine, because they are headlines and not the logo.

## Shape, depth and space

- **Buttons, chips and badges are pills** (`--radius-pill`). Cards use `--radius-md`, panels and sheets
  `--radius-lg`, inputs `--radius-sm`. `--radius-xl` is for marketing hero blocks only.
- Core shadows, both tinted blue: `--shadow` for cards, `--shadow-lg` for marketing feature cards and modals.
  No grey or black shadows.
- Sticker depth: an ink outline (`--outline` 3px for frames, `--outline-thin` 2px for cells and chips) plus
  `--shadow-hard`, a solid ink drop with no blur. Use outline and hard shadow together, never alongside the soft
  shadows.
- Rows inside a sticker frame are square-cornered cells with thin outlines, like the flyer. Only the outer frame
  is rounded.
- Spacing sits on a 4px grid (`--space-1` to `--space-8`). Inside a card use `--space-4` or `--space-5`; between
  marketing sections `--space-8`.

## Patterns

Pattern tokens are full `background-image` values. Apply them with the helper classes, or as
`background: var(--pattern-grid), var(--cream);`.

| Pattern | Class | Paper | Use |
|---|---|---|---|
| Grid | `.k-paper-grid` | `--cream` | The default sticker paper. Closest to the core blue and white. |
| Stripes | `.k-paper-stripes` | `--cream` | Drinks and seasonal promos. |
| Gingham | `.k-paper-gingham` | `--gingham-paper` | Food, snacks, picnic feel. Optionally finish the foot with a `--pattern-checker` strip. |

- One pattern per page or poster. Patterns sit behind panels; text never sits directly on a pattern.
- Keep patterns large and calm (48 to 56px cells). Never animate them, except on the wall.

## Components

### Core

**Buttons**

| Kind | Look | Use |
|---|---|---|
| Primary | Blue fill, white text | The one main action on a screen. |
| Secondary | White fill, blue text, `--line` border | Other actions. On a blue section: white fill, blue text. |
| Quiet | `--blue-soft` fill, blue text | Low-weight actions, steppers, filters. |
| Danger | Red fill, white text, or red text on `--red-soft` | Void, cancel, delete. |

All buttons: pill shape, weight 900, uppercase, at least `--tap` tall (`--tap-lg` on the POS and pad). Pressed
state darkens to `--blue-dark` or scales down slightly. Disabled buttons fade and never change colour. In a sticker
section, buttons gain a `--outline-thin` ink border and `--shadow-hard`, and press down by removing the shadow.

**Cards** White, `--radius-md` or `--radius-lg`, `--shadow`, no border. Or a `--line` border with no shadow in
dense lists. Not both.

**Inputs** White, `--line` border, `--radius-sm`, at least `--tap` tall, label above in `--text-sm`. Errors show
in `--red` text under the field. Inputs never take the sticker style.

**Badges** Pill, `--text-sm`, weight 800. Bestseller and promo: `--ink` on `--amber`. Status: the `-soft` fill
with the matching strong text.

**Focus** Every focusable element shows `outline: 3px solid var(--amber); outline-offset: 2px` on
`:focus-visible`. Never remove it. On a sticker card, the amber ring sits outside the ink outline.

### Retro sticker

**Sticker frame** (`.k-sticker`) A blue panel with an ink outline, `--radius-lg` and `--shadow-hard`, on patterned
paper. It holds an outlined heading, a stack of sticker rows and a short footer line ("100% MADE WITH LOVE").
Mascot stickers sit in the top corners.

**Sticker row** (`.k-sticker-row`) The flyer's menu row. A two-column cell: illustration on `--cream` on the left,
then name, options and price on `--peach` on the right. Name: uppercase, weight 900, `--text-lg`. Options: a short
bulleted list, uppercase `--text-sm`, weight 800. Price: `.k-price`, aligned right. It stacks to one column below
640px. A small face sticker may overlap the seam between the two cells.

**Mascot stickers** Googly eyes (top left) and a smiley (top right) on frames; a small yellow face on each row's
seam. Use them as decoration with `alt=""`. At most two large mascots per frame.

## Layout

- Breakpoints: **920px** (columns stack) and **640px** (phone). Verify at 375, 768, 1024 and 1440px.
- Marketing content sits in a 1120px container with 16px side gutters. A sticker frame is at most 760px wide, so
  it reads as a menu board rather than a full-width band.
- Nothing scrolls sideways at any width.
- Tap targets are at least 44px, with 8px between neighbours.

## Motion

Short and soft: `--ease` (0.15s) for colour and small movement. Stickers may wobble a few degrees on hover; that is
the only playful motion outside the wall. Respect `prefers-reduced-motion`. The wall is the exception; its
animation is the point.

## Logo and imagery

| File | Use |
|---|---|
| `public/brand/kennko.png` | Logo, blue on white. |
| `public/brand/word-logo.jpg` | Logo, white on blue. |
| `public/brand/kennko_1.png` | Alternate wordmark, blue on white. |
| `public/brand/kennco-banner_2.png` | Repeating banner, white on blue. |
| `badge.png`, `icon.png`, `wordmark-blue.png`, `wordmark-white.png` (in `apps/pos` and `wall`) | App header, favicon, receipts. |
| `brand/assets/food-menu/food-menu-{grid,stripes,gingham}.png` | Food menu flyer, 1414×2000, one per paper. Reference for the sticker layer, and printable as is. |
| `brand/assets/food-menu/illo-{cookies,empanada,fries}.png` | Food illustrations cropped from the flyer, on cream. |
| `brand/assets/food-menu/sticker-{eyes,smiley}-on-blue.png` | Mascot stickers cropped on the panel blue. |

- Blue logo on white, white logo on blue. Nothing else: no recolouring, stretching, outlines or drop shadows. The
  sticker outline treatment never applies to the logo.
- Keep clear space around the logo of at least the height of its "K".
- **Two kinds of imagery.** Drinks use photos: bright, close-up, on light backgrounds, with rounded corners
  (`--radius-md` or larger). Food and sticker sections use illustrations: flat fills, thick black keylines, a
  coloured oval plate, and food with small cartoon faces. Don't mix a photo and an illustration in one card.
- **Drawn drinks.** `apps/web/components/site/CupSticker.tsx` draws an iced cup with a face in the flyer's style,
  in five flavours (coffee, caramel, strawberry, matcha, choco) on any plate colour. Use it wherever a drink needs
  art and there is no current photo.
- New illustrations follow the flyer's recipe: one dish, one plate colour (pink, orange or yellow, rotating down a
  list), and a checker or gingham napkin.
- `brand/Kennko Menu.png` is a data reference only. Its navy and serif styling is not the design direction.

## Voice

Fun, friendly and warm; short, punchy lines; never corporate. Buttons say what they do ("Send to wall", "Charge",
"Order now"). Errors say what happened and what to do next, without blame. Sticker sections can be sillier
("100% MADE WITH LOVE"), but keep them to one short line.

## Where the tokens live

- **Website** and **POS** import `@kennko/tokens/tokens.css`. Change a value there, not in the app.
- **Wall and pad** (`wall/public/*.css`) cannot import, so they keep a hand copy of the values they use. Change
  `tokens.css` first, then copy across.
- The `.k-*` helper classes ship in the same file. They are opt-in and change nothing until a page uses them.

## Still open

- **New photos.** The landing page dropped every 2025 photo (people, egg coffee, cloud soda, perks card). It uses
  drawn cups, the food art and a drawn stamp card instead. When new people or drink photos exist, add them as
  sticker cards: `--outline` frame, `--shadow-hard`, a slight tilt, on the grid paper.
- **Food on the menu.** The flyer lists Cookies (Original, Chocolate, Red Velvet), Empanada (Chicken) and Fries
  (Original, Cheese, BBQ, Sour Cream). None are in the ordering system yet. The website shows them from a
  hard-coded list in `apps/web/components/site/FoodMenu.tsx`; move it to `packages/core` when food becomes orderable.
- **"EMPANDA" typo** on all three flyers. It should read "EMPANADA". Ask the designer for a corrected export.
- **Source files.** The illustrations and stickers are flat PNG crops: the plate's right tip is clipped where the
  face sticker overlaps it, and the stickers sit on blue rather than a transparent background. Get the Canva
  source or transparent PNG/SVG exports.
- **Display font.** The flyer headings use a chunky rounded display face, not Nunito. Nunito 900 with
  `.k-outlined` stands in for now. Name the flyer font if a second display family is wanted.
- **No vector logos.** Every logo is a PNG or JPG. SVG versions would stay sharp on the projector and on receipts.
- **Two copies of the small logo set** (`apps/pos` and `wall`) will drift. They could move into this package.
