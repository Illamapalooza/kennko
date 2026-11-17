# Kennko Cat Cafe Wall — Design

Date: 2026-11-16
Status: approved and built 2026-11-16 (see "As built" at the end)

## Intent

Kennko Coffee has a projector in the shop. While the real baristas are working,
the wall should show a pixel-art cafe run by cats: cat baristas making the
drinks that are really being made, cat customers waiting, and a clear readout of
what is being prepared and what is ready to collect. It is ambience and an order
board at once. Background music plays from the same screen.

It is the Kennko counterpart of RAFTEL (the CABIN town office): a live scene
driven by real work. It shares the idea only. No Pokémon art, names, tiles or
code are reused; the cats and the cafe are original.

## Who it is for

- **Customers in the shop** look at the wall. They want to know "is mine being
  made" and "is mine ready".
- **Baristas** feed it from the counter tablet, in as few taps as possible.

## Goals

1. One command starts everything and opens the wall in a browser, full screen.
2. A walk-in order entered on the tablet appears on the wall within a second.
3. A customer can read their order number and its state from across the room.
4. Looks like Kennko: electric blue `#0055FF`, white, amber `#FFB830`, bright.
5. A shuffled, looping playlist plays from a folder of audio files.
6. Keeps working if the internet drops.

## Non-goals (v1)

- Online (website/GCash) orders on the wall. In-store orders only for now.
- Payments, prices, receipts, sales reports. This is not a POS.
- Reading from whatever the baristas use today to ring up orders. The order pad
  is a second, tiny entry step.
- Running inside Obsidian or the Kennko website.

## Anti-goals

- Customer phone numbers, addresses or prices on the wall.
- A dark theme (the brand forbids it).
- Anything that makes a barista slower during a rush. If the pad takes more than
  a few taps per order, it will be ignored and the wall will lie.
- A wall that looks dead when there are no orders.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **1 (chosen)** | **Local mini server.** One zero-dependency Node script on the projector laptop serves the wall page and the order pad, keeps orders in a local file, pushes changes live. Tablet opens the pad over the cafe wifi. | Works offline, no accounts, truly standalone. Tablet and laptop must be on the same wifi. Online orders need a later add-on. |
| 2 | Pages inside the Kennko website, orders in Supabase. | Online orders merge in for free and it works from anywhere, but needs internet, staff login, a database change and a deploy. Not a standalone script. |
| 3 | A single HTML file, no server. | Simplest to run, but the pad and the wall would have to be on the same computer, so the tablet could not drive it. |

Julius asked for a standalone browser scene started by a script and left the how
to Claude; approach 1 is Claude's call.

## How it works

```
 counter tablet                 projector laptop                     wall
 ┌───────────┐   wifi   ┌──────────────────────────┐   HDMI   ┌──────────────┐
 │ order pad │ ───────▶ │ kennko-wall (Node script)│ ───────▶ │ cat cafe     │
 │  /pad     │ ◀─────── │ orders file + live push  │          │  /           │
 └───────────┘          └──────────────────────────┘          └──────────────┘
```

### Where it lives

`~/Projects/kennko/wall/`, self-contained, sharing nothing with the Next.js app
(no imports either way, no npm install needed to run it).

```
wall/
  kennko-wall          executable launcher (starts server, opens browser)
  server.mjs           HTTP + Server-Sent Events, plain Node, no dependencies
  store.mjs            order state + rules (pure, unit tested)
  menu.json            drinks grouped by category (from brand/BRIEF.md)
  public/
    index.html         the wall
    pad.html           the order pad
    scene/…            canvas renderer, cat sprites, animation
  music/               drop audio files here (git-ignored)
  data/                today's orders (git-ignored)
  test/                node --test
```

Plain JavaScript modules, like the CABIN office. Any TypeScript uses `type`,
never `interface`.

### Running it

`./wall/kennko-wall` starts the server on a fixed port, prints the tablet
address (`http://<laptop-ip>:<port>/pad`) and shows it on the wall's opening
screen, then opens the wall in the default browser. The wall
opens on a "tap to open the cafe" screen; that one tap starts the music (browsers
block sound until someone interacts) and goes full screen.

`./wall/kennko-wall --demo` runs the scene with made-up orders and no tablet, for
showing it off or when nobody wants to key orders.

### An order

- **Number:** counts up from 1, resets each day (Manila time).
- **Name:** optional first name.
- **Drinks:** one or more from the menu, with a quantity. No sizes, add-ons or
  prices; the wall only needs to say what is being made.
- **State:** `queued → preparing → serving → done`, plus `cancelled`.

### The order pad (tablet)

One screen, big touch targets, Kennko blue.

```
┌───────────────────────────────────────────────────────────────┐
│ KENNKO PAD                         Baristas on shift: [-] 2 [+]│
├──────────────────────────┬────────────────────────────────────┤
│ NEW ORDER  #16           │ QUEUED        PREPARING    SERVING │
│ Name (optional) [_____]  │ ┌──────────┐  ┌─────────┐ ┌───────┐│
│ ★ Spanish Latte    [+]   │ │#15 Ana   │  │#14      │ │#12 Jo ││
│ ★ Caramel Macch.   [+]   │ │Matcha    │  │Egg Coff.│ │Latte  ││
│ Americano          [+]   │ │ [START]  │  │ [READY] │ │[DONE] ││
│ …categories as tabs…     │ └──────────┘  └─────────┘ └───────┘│
│ [ SEND TO WALL ]         │                                    │
└──────────────────────────┴────────────────────────────────────┘
```

- Bestsellers first, the rest behind category tabs.
- One button per card moves it to the next state. Long-press for undo/cancel.
- "Baristas on shift" sets how many cat baristas are behind the counter (1–3).
  At 0 the cafe shows as closed: cats napping, no board.
- After SEND the pad shows the new number large, so the barista can tell the
  customer "you're number 16". (Claude's call; see open questions.)
- A 4-digit PIN, set in the config, asked once per device. Customers may share
  the cafe wifi. (Claude's call.)

### The wall

16:9, pixel art scaled by whole numbers so it stays crisp on the projector.

```
┌────────────────────────────────────────────────────────────────────┐
│ KENNKO COFFEE          ♪ now playing: track name            2:41 PM│
│ ┌──────────────────────────────────────────────┐ ┌───────────────┐ │
│ │ menu board    espresso machine   shelves     │ │ NOW PREPARING │ │
│ │   =^.^=  (steam)        =^.^=  (pouring)     │ │  14  Egg Coffee│ │
│ │ ─────────── counter ────────  pickup [12]    │ │  15  Ana       │ │
│ │                                              │ ├───────────────┤ │
│ │  door    =^.^= =^.^=  (queue)                │ │ NOW SERVING   │ │
│ │          tables: cats sipping, one napping   │ │  12  Jo       │ │
│ └──────────────────────────────────────────────┘ └───────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

What each real event looks like:

| Real event | On the wall |
|---|---|
| Order sent from pad | A customer cat walks in the door and joins the queue; a ticket with the number pins up behind the counter. |
| Barista taps START | A free barista cat takes the ticket and works the machine; the drink name floats above them; the number moves to NOW PREPARING. |
| Barista taps READY | The drink lands on the pickup shelf with a bell sound; the number shows large for a few seconds, then sits in NOW SERVING; the customer cat walks up and collects it. |
| Barista taps DONE | The cat carries the drink to a table, sips for a while, then leaves. The number drops off the board. |
| Nothing happening | Idle life: baristas wipe the counter, a cat naps in the window, someone reads. Never a frozen frame. |

- An order is one ticket and one barista cat, however many drinks it holds; the
  drink names cycle above the cat. (Claude's call.)
- The pad never blocks a tap. If more orders are started than there are barista
  cats, the board shows them all as preparing and a cat picks each up as it
  frees. The board is the truth; the cats are the show. (Claude's call.)
- Each customer cat gets a coat (ginger, tuxedo, calico, grey tabby, white…)
  picked from the order number, so it stays the same cat from door to table.
- More orders than fit on the board: show the oldest few and "+N more".
- A READY order nobody taps DONE on clears itself after a set time, so a
  forgotten tap does not leave a number up all day.
- Reloading the wall or pad restores today's state from the file.

### Music

- Plays every audio file in `wall/music/`, shuffled, looping, at a volume set in
  a small config. Track title (from the filename) shows in the top bar.
- The READY bell briefly dips the music.
- An empty folder means a silent wall, not an error. Julius supplies the tracks;
  none are shipped.

## Constraints

- Node 24 is on the dev machine; the script must run on stock Node 20+ with no
  install step.
- The laptop and tablet share the cafe wifi.
- Kennko brand rules from `brand/BRIEF.md`: blue, white, amber accent, rounded
  playful type, uppercase headings, no dark backgrounds.
- No third-party sprite sheets or game assets. Cats and furniture are original
  pixel art drawn in code (character maps + palettes, the technique RAFTEL uses).

## Left to the builder

- Exact cat sprite designs, frame counts, room layout and palette shades.
- Port number, autoclear time, board capacity, default volume.
- Wire format between pad, server and wall.
- Whether the Kennko logo image is used on the wall or the name is drawn in type.

## Testing

- Unit tests for the order rules: numbering and daily reset, allowed state
  moves, undo, autoclear, restore from file.
- Unit tests for the pure scene logic: which cat is assigned to which order,
  what the board shows when it overflows.
- A run-through in a real browser with pad and wall side by side, at projector
  size, including `--demo`.

## Open questions for Julius

1. How does a customer know which number on the wall is theirs? The design has
   the wall issue its own number and the barista say it aloud. If the till
   already gives a number or the baristas call names, the pad should take that
   instead.
2. What is the projector computer (Mac or Windows, Node installed?) and who
   starts the wall each day: Julius in a terminal, or a barista double-clicking
   an icon?
3. What runs on the counter tablet today, and can it also keep the pad open in a
   browser tab? If not, the pad needs to be laid out for a phone.

## Risks

- Some cafe routers stop devices on the wifi from seeing each other, which would
  cut the tablet off from the laptop. Test on site before relying on it. Fallback:
  run the pad in a second window on the laptop itself.

## As built

- The three open questions were not answered before the build, so Claude's calls stand: the wall issues its own
  number, launchers exist for Mac and Windows, and the pad stacks into one column on a phone.
- The pad address is shown as text, not a QR code: a QR encoder would have been the only dependency.
- Julius asked mid-build for Kennko's real logos. The wordmark from `public/brand/` is used in the top bar, on the
  cafe wall, on the counter front, on the opening screen and on the pad. Copies live in `wall/public/brand/`.
- Wrong PINs lock a device out for five minutes after eight tries.

## Change of direction (same day)

After seeing it, Julius clarified: the wall is **not** an order board. Drinks are served to the customer's table, so
the wall only needs to be nice visuals. What changed:

- **Default is now visuals only.** The cafe runs itself: made-up customers, drinks from `menu.json`, nothing keyed in,
  nothing saved. No board, no order numbers, no ready banner or bell. The scene takes the whole wall (288 x 152).
- **Table service.** Customers sit down first; a server cat carries each finished drink from the counter tray to
  the table. The pickup counter flow is gone.
- **The pad and board survive behind `--orders`** (replacing `--demo`). Goals 2 and 3 above now apply to that mode only.
