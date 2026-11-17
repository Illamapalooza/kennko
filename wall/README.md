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
| `--orders` | Tablet-driven mode instead of the self-running cafe (see below) |
| `--no-open` | Don't open the browser |
| `--port 5000` | Use another port |

## Optional: orders mode

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
- **Menu:** edit `menu.json`. These are the drink names the barista cats show while they work.

## If something is off

| Symptom | Likely cause |
|---|---|
| No sound | `music/` is empty, or the wall was never tapped open. |
| "Port already in use" | The wall is already running in another window. |

## Tests

`node --test wall/test/*.test.mjs`
