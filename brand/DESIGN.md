# Kennko Design Guidelines

**Status: draft, 2026-11-17.** The tokens are written but no app imports them yet (see "Adopting the tokens").

How Kennko looks on every screen: the website, the POS, the order pad and the wall. `BRIEF.md` says who the brand
is; this says how to build with it. The values live in `packages/tokens/tokens.css`. Use the variables, never a raw
hex code or pixel radius.

## The look in one paragraph

Electric blue and white, bold and rounded, a little playful. Big uppercase headings, pill-shaped buttons, soft
blue-tinted shadows, plenty of white space. Amber appears rarely, so it means something when it does. There is no
dark theme, no black, and no grey: neutral tones are tinted blue.

## Colour

| Token | Value | Use |
|---|---|---|
| `--blue` | `#0055ff` | Primary. Main buttons, headings, links, full blue sections. |
| `--blue-dark` | `#003fc0` | Hover and pressed states of blue. |
| `--blue-soft` | `#e8efff` | Chips, selected rows, quiet buttons. |
| `--blue-wash` | `#f3f6ff` | App background behind white cards. |
| `--white` | `#ffffff` | Cards, text on blue. |
| `--amber` | `#ffb830` | Accent: promo badges, bestseller stars, focus ring. |
| `--amber-soft` | `#fff3d6` | Fill behind an amber badge. |
| `--ink` | `#0d1b3d` | Body text. |
| `--ink-soft` | `#55628a` | Secondary text, labels, hints. |
| `--line` | `#d9e3fb` | Borders and dividers. |
| `--red` / `--red-soft` | `#d92d3a` / `#ffe9eb` | Errors, voids, cancel, negative amounts. |
| `--green` / `--green-soft` | `#0f9d63` / `#e2f7ee` | Success, available, positive amounts. |

Rules:

- A screen is either **white with blue** or **blue with white**. Never dark.
- **Amber is an accent, not a colour scheme.** One or two amber things per screen at most.
- **Amber is never text on white**; it is too faint to read. Put `--ink` text on an amber fill instead.
- Text on blue is white. Text on white is `--ink`, or `--blue` for headings and links.
- Red and green carry meaning only. Never use them to decorate.
- Never show status by colour alone; pair it with a word or an icon.

## Type

One family everywhere: **Nunito** (`--font`), a rounded sans-serif that matches the bubble logo.

| Role | Size token | Weight | Style |
|---|---|---|---|
| Hero (marketing only) | `--text-hero` | 900 | Uppercase |
| Section heading (marketing) | `--text-display` | 900 | Uppercase |
| Page title (apps) | `--text-xl` | 900 | Uppercase, blue |
| Section title (apps) | `--text-lg` | 900 | Uppercase |
| Card title, lead text | `--text-md` | 800 | Sentence case |
| Body | `--text-base` | 600 | Sentence case |
| Label, hint, badge | `--text-sm` | 700 to 800 | Small labels uppercase with `--tracking-label` |
| Fine print | `--text-xs` | 600 | Sentence case |

- Headings are uppercase and heavy, with `--leading-tight`. Body text is never uppercase.
- Keep body text at 16px or larger. On shop tablets the base is 17px.
- Prices use tabular figures (`font-variant-numeric: tabular-nums`) so columns line up.
- The logo is artwork, not a font. Never retype "KENNKO" in Nunito as a stand-in for the logo.

## Shape, depth and space

- **Buttons, chips and badges are pills** (`--radius-pill`). Cards use `--radius-md`, panels and sheets
  `--radius-lg`, inputs `--radius-sm`. `--radius-xl` is for marketing hero blocks only.
- Two shadows, both tinted blue: `--shadow` for cards, `--shadow-lg` for marketing feature cards and modals.
  No grey or black shadows.
- Spacing sits on a 4px grid (`--space-1` to `--space-8`). Inside a card use `--space-4` or `--space-5`; between
  marketing sections `--space-8`.

## Components

**Buttons**

| Kind | Look | Use |
|---|---|---|
| Primary | Blue fill, white text | The one main action on a screen. |
| Secondary | White fill, blue text, `--line` border | Other actions. On a blue section: white fill, blue text. |
| Quiet | `--blue-soft` fill, blue text | Low-weight actions, steppers, filters. |
| Danger | Red fill, white text, or red text on `--red-soft` | Void, cancel, delete. |

All buttons: pill shape, weight 900, uppercase, at least `--tap` tall (`--tap-lg` on the POS and pad). Pressed
state darkens to `--blue-dark` or scales down slightly. Disabled buttons fade and never change colour.

**Cards** White, `--radius-md` or `--radius-lg`, `--shadow`, no border. Or a `--line` border with no shadow in
dense lists. Not both.

**Inputs** White, `--line` border, `--radius-sm`, at least `--tap` tall, label above in `--text-sm`. Errors show
in `--red` text under the field.

**Badges** Pill, `--text-sm`, weight 800. Bestseller and promo: `--ink` on `--amber`. Status: the `-soft` fill
with the matching strong text.

**Focus** Every focusable element shows `outline: 3px solid var(--amber); outline-offset: 2px` on
`:focus-visible`. Never remove it.

## Layout

- Breakpoints: **920px** (columns stack) and **640px** (phone). Verify at 375, 768, 1024 and 1440px.
- Marketing content sits in a 1120px container with 16px side gutters.
- Nothing scrolls sideways at any width.
- Tap targets are at least 44px, with 8px between neighbours.

## Motion

Short and soft: `--ease` (0.15s) for colour and small movement. Respect `prefers-reduced-motion`. The wall is the
exception; its animation is the point.

## Logo and imagery

| File (`public/brand/`) | Use |
|---|---|
| `kennko.png` | Logo, blue on white. |
| `word-logo.jpg` | Logo, white on blue. |
| `kennko_1.png` | Alternate wordmark, blue on white. |
| `kennco-banner_2.png` | Repeating banner, white on blue. |
| `badge.png`, `icon.png`, `wordmark-blue.png`, `wordmark-white.png` (in `apps/pos` and `wall`) | App header, favicon, receipts. |

- Blue logo on white, white logo on blue. Nothing else: no recolouring, stretching, outlines or drop shadows.
- Keep clear space around the logo of at least the height of its "K".
- Product photos are bright and close-up, on light backgrounds, with rounded corners (`--radius-md` or larger).
- `brand/Kennko Menu.png` is a data reference only. Its navy and serif styling is not the design direction.

## Voice

Fun, friendly and warm; short, punchy lines; never corporate. Buttons say what they do ("Send to wall", "Charge",
"Order now"). Errors say what happened and what to do next, without blame.

## Adopting the tokens

Nothing imports `packages/tokens/tokens.css` yet. When wiring it in:

1. **POS** (`apps/pos/src/styles.css`): import the file and delete the local `:root` block. Values are identical,
   so nothing should change on screen.
2. **Website** (`app/globals.css`): import the file and delete the local `:root` block. Visible changes: the font
   moves from Inter to Nunito, `--radius-lg` goes from 22px to 24px, and `--text` and `--muted` are renamed to
   `--ink` and `--blue-soft`. The big shadow is now `--shadow-lg`.
3. **Wall and pad** (`wall/public/*.css`): they cannot import, so update their copies by hand. `--blue-d`
   `#0041c4` becomes `#003fc0`, `--ink` `#1a2340` becomes `#0d1b3d`, `--red` `#d0342c` becomes `#d92d3a`.

## Still open

- **The font is a proposal.** The brief only asks for a rounded sans-serif. The POS already uses Nunito; the
  website uses Inter, which is not rounded. Confirm Nunito or name another.
- **No vector logos.** Every logo is a PNG or JPG. SVG versions would stay sharp on the projector and on receipts.
- **Two copies of the small logo set** (`apps/pos` and `wall`) will drift. They could move into this package once the apps import it.
