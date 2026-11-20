# Kennko Wall

The cat cafe for the shop projector: cat baristas make drinks, a server cat carries them to the tables, customer
cats come in, sip and leave. It runs by itself as pure visuals, with the playlist behind it. Standalone: it shares
nothing with the website and needs no install.

## Start it

| Where | How |
|---|---|
| Mac | Double-click `start-wall.command`, or run `./wall/kennko-wall` |
| Windows | Double-click `start-wall.bat` |
| Anywhere | `node wall/server.mjs` |

Needs Node.js 20 or newer. The wall opens in the browser; tap the big button once to start the music and go full
screen. Wall keys: `M` mute, `N` next song, `F` full screen.

| Flag | What it does |
|---|---|
| `--pos [address]` | Follow the Kennko till: real orders drive the cats and the order board (see below) |
| `--no-board` | With `--pos`: cats only, no numbers or board |
| `--orders` | Tablet-driven mode instead of the self-running cafe (see below) |
| `--no-open` | Don't open the browser |
| `--port 5000` | Use another port |

## Following the till

`./wall/kennko-wall --pos` connects the wall to the Kennko POS (`apps/pos`). Nothing is keyed in twice: an order rung
up on the till walks in as a customer cat, and the wall shows the queue and calls it when it is ready.

| On the till | On the wall |
|---|---|
| Order paid | A customer cat comes in; the number joins **In line** |
| **Start** | A barista cat makes the drink; the number moves to **Now preparing** |
| **Ready** | Bell and "Order 4 for Dana is ready!"; the number moves to **Now serving**; the server cat carries the drink over |
| **Done** | The cat finishes and leaves; the number drops off |
| Void | The order is taken off the wall |
| Online order paid | Comes in like any other, shown as **W3** with the customer's first name |
| Online order out for delivery | Leaves the wall (delivery orders are not called at the counter) |
| Online order cancelled | Taken off the wall at the till's next sync (not instantly; it stays while the till is offline) |

- The number on the wall is the order number the till shows after payment and prints on the receipt. Online orders
  carry a `W` in front (W3) and are separate from counter number 3; the banner reads "Order W3 for Ana is ready!".
- The wall only receives drink names (including the menu's), first names and steps. It never sees prices or payments.
- The till is looked for at `http://localhost:4466`. If it runs on another computer, pass its address
  (`--pos http://192.168.1.20:4466`) or set `"posUrl"` in `config.json`.
- If the till cannot be reached, the wall keeps the last orders it saw and reconnects by itself. With `--no-board` it
  runs the made-up cafe until the till is back.
- From the repo root: `npm run wall:pos`.

## Optional: orders mode

This is the stand-alone pad, for when the till is not in use. It cannot be combined with `--pos`.


`./wall/kennko-wall --orders` turns off the self-running cafe. The cats then follow real orders keyed on a tablet,
and the wall gains an order board with numbers. Open the pad address the terminal prints (same wifi), enter the PIN:

1. Tap the drinks, add a name if you like, **Send to wall**.
2. **Start** when a barista begins it, **Ready** when it is made (the server cat carries it over), **Done** to finish.
3. **Back** undoes a step. **Cancel** removes an order. **Baristas on shift** sets the cats behind the counter.

## Settings

`config.json`:

| Key | Default | Meaning |
|---|---|---|
| `port` | 4455 | Port the wall listens on |
| `pin` | "1234" | Orders mode: pad PIN. Change it before using the pad. `""` turns the PIN off |
| `volume` | 0.5 | Music volume, 0 to 1 |
| `autoclearMinutes` | 10 | Orders mode: how long a ready order stays up |
| `boardSize` | 5 | Orders mode: rows per board column before "+N more" |
| `baristas` | 2 | Barista cats behind the counter in the self-running cafe (1 to 3) |

- **Music:** drop audio files (mp3, m4a, ogg, wav, flac) into `music/`. They play shuffled and loop. New files are
  picked up when the current round finishes.
- **Menu:** drink names come from the till (its published menu) and are remembered in `data/menu.json`; there is nothing to edit.
  A wall that has never reached a till uses four generic names in the self-running cafe, and the order pad says "No drinks yet".
  Without `--pos` it asks the till (`posUrl` or `http://localhost:4466`) for the menu at start and every 10 minutes.

## If something is off

| Symptom | Likely cause |
|---|---|
| No sound | `music/` is empty, or the wall was never tapped open. |
| "Port already in use" | The wall is already running in another window. |

## Tests

`node --test wall/test/*.test.mjs`

## Look

The wall wears the website's sticker theme (`brand/DESIGN.md`): cream grid paper, ink outlines and the Kennko cats.
It stays zero-dependency, so the cats are static SVGs in `public/brand/cats/`, exported from `packages/cats`.
After changing the cat drawings, run `npm run export-wall -w @kennko/cats` from the repo root.
