# Handover: Kennko POS and the wall

Written 2026-11-17 for whoever picks this up next. Read this before touching `apps/`, `packages/` or `wall/`.

## Where things stand

| Piece | Where | State |
|---|---|---|
| Website, online ordering, admin | repo root (`app/`, `lib/`, `supabase/`) | Built 2026-08-24. Online ordering is not live. |
| Cat cafe wall | `wall/` | Built 2026-11-16. Plain Node, no dependencies. Runs by itself as visuals; `--orders` mode has a tablet pad. |
| POS (the till) | `apps/pos/` | Built 2026-11-17. Working end to end. **Not yet connected to the wall.** |
| Shared rules | `packages/core/` | Money, menu types, ice, pricing, discounts, order statuses, sales summary. Used by the POS only so far. |

**Nothing from 16 or 17 November is committed.** Branch is `feat/ordering`. Untracked: `apps/`, `packages/`, `wall/`,
and the wall's spec and plan under `docs/superpowers/`. Modified: `package.json`, `package-lock.json`, `tsconfig.json`,
`vitest.config.ts`, `.gitignore`. Julius has not asked for a commit; ask before committing.

## What Julius decided

- The POS and the wall are **separate from the website** but live in **this repo as a monorepo**.
- **No Turborepo or Nx yet.** His words: add it "when the time comes". npm workspaces only.
- Order of work: **POS first, then connect the wall to the POS.**
- Later vision: **online orders appear in the POS queue** once online ordering goes live.
- Kennko's own branding and logos everywhere (it is his family's cafe). No dark themes.

## Decisions Claude made that Julius has not confirmed

He was asked twice whether the till must work without internet and what the counter uses today, and did not answer.
These defaults were built; change them if he says otherwise.

- The POS runs on a computer **in the shop** with a local SQLite file, so it works offline. It is not hosted.
- Customers **pay up front** at the counter. No open tabs.
- Payments are **cash and GCash** only. GCash is recorded, not integrated.
- Discounts: Senior/PWD 20%, Promo 10%, or a typed amount (set in `apps/pos/config.json`).
- Order numbers restart at 1 each Manila day.
- Voids, cash out, closing the till and menu update need the manager PIN.

## How the POS is put together

```
apps/pos/
  server/index.ts    HTTP API, live updates (Server-Sent Events), serves the screens
  server/store.ts    SQLite (node:sqlite): orders, shifts, cash moves, sold-out marks
  server/menu.ts     built-in menu from supabase/seed/menu.ts; optional pull from the website
  server/config.ts   config.json + defaults
  server/report.ts   CSV export
  src/               React screens (Vite): Sell, Pay, Orders, History, Till, Menu
  test/              vitest
packages/core/src/   shared, pure, tested
```

- Run: `npm run pos` from the repo root (http://localhost:4466, staff PIN `1234`, manager PIN `0000`).
- Shop: `npm run build -w @kennko/pos` then `npm start -w @kennko/pos`. Needs **Node 24+**.
- Tests: `npm run pos:test` (19 tests). The website's own `npm test` (156 tests) and `npx tsc --noEmit` still pass.
- The server **reprices every order from the menu**; the screen only sends ids and choices. Keep it that way.
- Money is integer centavos everywhere. Use `type`, never `interface`. Imports inside `apps/pos` and
  `packages/core` carry the `.ts` extension.
- `apps/pos/data/pos.db` is the only copy of the sales. It is git-ignored.
- `KENNKO_POS_DATA=/some/dir` points the server at a throwaway data folder for testing.

## Next: connect the wall to the POS

The POS order statuses are deliberately the wall's: `queued → preparing → serving → done` (the POS adds `voided`).

- The wall's own design doc (`docs/superpowers/specs/2026-11-16-kennko-cat-cafe-wall-design.md`) ends with a change of
  direction: the wall is **not an order board**. Drinks are served to tables; it is visuals. So "connected" most
  likely means the cats follow real POS orders, with no numbers or board on the wall. Confirm with Julius before
  bringing the board back.
- The POS already streams live state at `GET /api/events` (needs the staff PIN: `x-pin` header or `?pin=`). Each
  message carries `active`: every order that is queued, preparing or serving, with its lines.
- The wall's reducer in `wall/store.mjs` expects orders shaped `{ id, name, items: [{ name, qty }], status }`. The
  simplest link is a wall mode that reads the POS feed and maps POS orders onto that shape, replacing the made-up
  customers of the self-running mode. The wall's own pad (`--orders`) then becomes redundant.
- Decide with Julius whether the wall stays a separate zero-dependency script or moves under `apps/pos`.

## Other work still open

1. **Move the website to `apps/web`.** It is still at the repo root, which also acts as the workspace root. Vercel is
   not connected yet, so the root-directory setting can simply be set to `apps/web` when it is.
2. **Point the website at `packages/core`.** `lib/money.ts`, `lib/cart/total.ts`, `lib/cart/ice.ts` and
   `lib/menu/types.ts` are the originals that `packages/core` was copied from. Until the website imports from core
   there are two copies of the pricing rules.
3. `apps/pos/server/menu.ts` imports `../../../supabase/seed/menu.ts`. That path changes when the website moves.
4. **Menu update from the website is untested live.** On 2026-11-17 the Supabase host in `.env.local` did not
   resolve (the project may be paused or deleted). The row mapping is unit tested; the request itself is not.
5. A drink the website marks unavailable cannot be switched back on from the POS Menu screen (the switch only clears
   the POS's own sold-out mark). Only matters once the website menu is in use.
6. Receipt printing uses the browser's print dialog with an 80mm layout. Not tried on a real printer.
7. Online orders in the POS queue: the website's `orders` table and its statuses (`supabase/migrations/0005_orders.sql`)
   differ from the POS's, so this needs a mapping and a sync, not a shared table read.
8. Sales never leave the shop computer. No backup or sync of `pos.db` exists yet.
