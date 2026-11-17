# Kennko Cat Cafe Wall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone script that projects a live pixel-art cat cafe driven by in-store orders keyed on the counter tablet, with background music.

**Architecture:** One zero-dependency Node server in `wall/` holds the day's orders in a JSON file, serves two static pages (wall, pad) and pushes every change over Server-Sent Events. Order rules and scene bookkeeping are pure modules tested with `node --test`; the canvas renderer and pages are verified in a real browser.

**Tech Stack:** Node 20+ (built-ins only), plain ES modules, Canvas 2D, Web Audio, SSE.

**Spec:** `docs/superpowers/specs/2026-11-16-kennko-cat-cafe-wall-design.md`

## Global Constraints

- Nothing in `wall/` imports from the Next.js app, and nothing is installed to run it.
- Brand: `#0055FF`, `#FFFFFF`, accent `#FFB830`; bright backgrounds only; uppercase headings.
- The wall shows order number, first name and drink names only.
- Original pixel art drawn in code. No third-party sprites, no Pokémon assets.
- Order flow: `queued → preparing → serving → done`, plus `cancelled`. Numbers start at 1 and reset each Manila day.
- The pad never rejects a tap because of barista count.

## Review Focus

- Wall reloaded mid-service: cats appear in place, the board is right, no bell storm.
- A READY order nobody marks DONE: clears itself after `autoclearMinutes`.
- Corrupt or missing `data/orders.json`: the server still starts, with an empty day.
- Empty `music/` folder or an unplayable file: silent wall, no error loop.
- More live orders than waiting spots, seats or board rows: nothing overlaps into nonsense, the board says "+N more".

---

### Task 1: Order rules

**Files:** Create `wall/store.mjs`, `wall/test/store.test.mjs`

**Produces:** `manilaDay(ms)`, `emptyState(day, baristas)`, `reduce(state, action, nowMs, opts)`, `normalize(raw)`, `OrderError`. Actions: `create {name, items}`, `advance {id}`, `undo {id}`, `cancel {id}`, `baristas {count}`, `tick`.

- [ ] Tests: numbering from 1; daily reset keeps barista count; full flow; advance past done throws; undo steps back and restores a cancelled order; cancel of a finished order throws; serving autoclears after `autoclearMs`; bad items, quantities and names rejected or cleaned; `normalize` returns null on junk.
- [ ] Implement, run `node --test wall/test/`.

### Task 2: Scene bookkeeping

**Files:** Create `wall/public/scene/logic.mjs`, `wall/test/logic.test.mjs`

**Produces:** `coatFor(id)`, `assignBaristas(prev, preparingIds, count)`, `assignSlots(prev, ids, slotCount)`, `boardView(orders, cap)`, `itemsLabel(items)`, `trackTitle(file)`.

- [ ] Tests: assignments are sticky; a freed barista takes the oldest unassigned order; overflow orders get no cat but stay on the board; board caps with a `more` count; track titles lose extensions and track numbers.
- [ ] Implement, run tests.

### Task 3: Server and launcher

**Files:** Create `wall/server.mjs`, `wall/config.json`, `wall/menu.json`, `wall/kennko-wall`, `wall/start-wall.command`, `wall/start-wall.bat`; modify `.gitignore`, `vitest.config.ts`

- [ ] Routes: `/`, `/pad`, static files, `/music/*` with range requests, `/api/bootstrap`, `/api/events`, `/api/playlist`, `/api/pin`, `/api/action` (PIN in `x-pin`).
- [ ] Atomic save to `data/orders.json`; a corrupt file is set aside, not fatal.
- [ ] `--demo` (in-memory, simulated orders), `--no-open`, `--port`.
- [ ] Verify with curl: create, advance, wrong PIN, path traversal, SSE.

### Task 4: Order pad

**Files:** Create `wall/public/pad.html`, `pad.css`, `pad.js`

- [ ] PIN gate, order builder with bestsellers first, three state columns, undo/cancel, baristas stepper, large number confirmation after send. Usable on a tablet and a phone.

### Task 5: The wall

**Files:** Create `wall/public/index.html`, `wall.css`, `wall.mjs`, `scene/sprites.mjs`, `scene/scene.mjs`

- [ ] Cafe room, cat sprites and coats, barista and customer behaviour per the spec's event table, idle life, closed state.
- [ ] Board, ready banner and bell, playlist with ducking, clock, start screen showing the pad address.

### Task 6: Run-through

- [ ] `node --test wall/test/` passes; `npm test` still passes.
- [ ] In a browser at 1920×1080: demo mode, then a real order driven from the pad through every state; reload mid-order.
- [ ] `wall/README.md` with setup for the shop.
