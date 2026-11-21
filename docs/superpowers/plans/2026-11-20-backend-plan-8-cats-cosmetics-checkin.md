# Backend Plan 8: Kennko Cats, Cosmetics, Wall Check-in — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Every Kennko card holder has a pixel cat. They name it, dress it in five slots (coat, hat, face, neck, held item) and buy more cosmetics with their points. Cosmetics are never sold for money.
- The wall shows a QR code that changes every minute. A signed-in customer who scans it starts a 90-minute visit, and their cat walks onto the projector wall with its cosmetics and name.
- Admin can hide any cat from the wall and keep the cosmetics catalogue (names, prices, on or off).

**Architecture:**
- **Art:** the pixel drawing code moves out of `wall/public/scene/sprites.mjs` into one plain-JavaScript module, `packages/cats/src/pixel-cats.js`, which also draws every cosmetic. The website imports it. The wall gets a committed copy (`wall/public/scene/cats.mjs`) written by the existing `export-wall` script, and a wall test fails if the copy differs from the source. So the wall stays zero-dependency and runnable from its own folder, and a cat looks the same in the customiser and on the projector.
- **Data:** one migration (`0020_cats_and_visits.sql`) adds `cosmetics` (seeded with the starter catalogue), `customer_cosmetics`, `cats`, `visits` and `shop_secrets`. It creates a starter cat for every existing customer. The database stores only cosmetic keys and prices.
- **API:**
  - customer routes `GET /v1/cosmetics`, `PUT /v1/me/cat`, `POST /v1/me/cosmetics/:id/buy` and `POST /v1/checkin`;
  - `GET /v1/me` gains the cat and the owned keys;
  - join creates the starter cat;
  - admin routes to hide a cat and edit the catalogue.
  
  A purchase spends points under Plan 7's customer lock.
- **Wall code:** the till receives the shop's check-in secret in the pull. Each minute it computes `wallCode(secret, minute)`, an HMAC truncated to 40 bits, in **server time** (the clock skew it already measures from the API's `Date` header). It sends the wall only the check-in URL and that URL's QR modules. The API accepts the code for the current and the previous minute.
- **Visits:** one row per customer, extended to `max(ends_at, now + 90 min)` on each check-in and by a linked counter order while a visit is active and "Show me on the wall" is on.
  - The pull carries at most 12 active visitors, the most recent arrivals, as `{ key, name, look, endsAt }` only.
  - The till caches them and puts them in the wall feed.
  - The wall walks them in and out.
  - The wall never talks to the internet.

**Tech Stack:** Hono 4, postgres.js 3, zod 4, vitest 4, PGlite harness (`apps/api/test/pg.ts`), Next.js 16 (App Router, server actions), Node 24 + `node:sqlite` (till), React 19, plain Node (wall, `node --test`). Web Crypto (`globalThis.crypto.subtle`) for the HMAC, in core, so the till and the API share one implementation. One new dependency: `qrcode` in `apps/pos`, the same pure-JS package the website already uses. It renders the wall's QR modules on the till, so the wall needs no library. Nothing new goes into the API bundle.

**Spec:** `docs/superpowers/specs/2026-11-20-kennko-accounts-loyalty-cats-design.md`, rollout steps 3–4:
- Points and the cat (the cat, cat names, art);
- The cat on the wall;
- Schema: `cosmetics`, `customer_cosmetics`, `cats`, `visits`, `shop_secrets`;
- The till's pull (the check-in secret, active visits);
- API additions (`GET /v1/cosmetics`, buy, `PUT /v1/me/cat`, `POST /v1/checkin`, admin hide cat and catalogue);
- Changes to each app (`packages/cats`, `wall`, the cat parts of `apps/web` and `apps/pos`);
- Left to the builder (the first catalogue, and the must-have tests listed under Review Focus).

### Where this plan sits

Plans 1–7 are implemented and deployed: the API and website are live, and the till is not yet updated. The latest migration is `0019_customers_and_stamps.sql`, applied live. This is roadmap row 8, the last one. It builds on:
- Plan 7's `customers`, `points_ledger` (`reason 'cosmetic'` and the plain `cosmetic_id` column are already there), `lockCustomer`, `balance`, `rate_limits` + `hit()`, `TillCustomer.catName` (null until now), the deletion cascade from `customers`, and the pull's allowlist pattern;
- Plan 4's clock skew (`clockSkew()` in `apps/pos/server/sync.ts`);
- Plan 5's wall feed allowlist (`apps/pos/server/wall-feed.ts`, `wall/pos-link.mjs`).

**Out of scope:** trading and gifting, leaderboards, animated cosmetics, cosmetics for the barista cats, more cat poses on the wall (visitors use the existing standing sprite), rotating the check-in secret from admin (Ruling 14), and changing the website's decorative `CatToon` (SVG flyer-style cats stay as they are).

## Global Constraints

- Money is integer centavos everywhere; format only at render with `formatPesos()`. **Points are integers, never money. Cosmetics have no peso price anywhere.**
- Use `type`, never `interface`.
- Imports carry their extension:
  - `.ts` inside `packages/core`;
  - `.js` for relative imports in `apps/api/src`;
  - `.ts`/`.tsx` in `apps/pos`;
  - `.js`/`.mjs` in `packages/cats` and `wall`.
- `packages/cats/src/pixel-cats.js` is **plain JavaScript with no imports and no DOM access at import time**. Types live beside it in `pixel-cats.d.ts`. The wall copy is never edited by hand.
- The API connects as `kennko_api`. Every new table has RLS on, `revoke all … from anon, authenticated`, and explicit grants with matching `to kennko_api` policies. Privileges are tested with `has_table_privilege`. **Every API task adds its routes to `apps/api/test/sync-as-api-role.test.ts`** (seed as superuser, run the app under `set role kennko_api`). Plan 4 once shipped a missing grant.
- **Lock order** (as in Plan 7): the order row first, when there is one, then the customer row. A purchase, an equip and a check-in each run in one transaction that holds `lockCustomer`.
- Time comes from `deps.now()` in API code, never SQL `now()`. The till's wall code uses `Date.now() + clockSkewMs`.
- **The check-in secret never leaves the till's server process.** It is not in the wall feed, the tablets' feed, any `/api/*` answer of the till, logs or the backup copy. The wall receives only `{ url, modules }`.
- **The till and the wall never receive a real name, email, customer id, card code or point balance for a visitor**: only the per-visit key, the cat name, the look and the end time. Tests pin this.
- Cat names are validated by one core function (`checkCatName`) in the API. The website uses it for live feedback. The wall and the till still treat names as plain text (`textContent`, never HTML).
- No new environment variables. The check-in URL is a core constant (Ruling 4).
- Brand: electric blue `#0055FF`, white, amber `#FFB830` accent, no dark styles. The customiser follows the sticker style in `brand/DESIGN.md`. Pixel art keeps `imageSmoothingEnabled = false` at integer scales.
- Run `npm test` and `npm run typecheck` from the repo root before every commit.

## Rulings made while planning (Claude's calls)

1. **One art module, copied into the wall.**
   - `packages/cats/src/pixel-cats.js` holds the 14×16 cat, the coat palettes, the loaf, every cosmetic overlay and `drawCat(ctx, x, y, look, opts)`.
   - `npm run export-wall -w @kennko/cats` (the existing script, extended) also writes it byte for byte to `wall/public/scene/cats.mjs`. `wall/test/cats-copy.test.mjs` compares the two files when the repo is present.
   - `wall/public/scene/sprites.mjs` re-exports the cat parts from `./cats.mjs` and keeps the cup, the glyphs and the text helpers.
   - The website imports `@kennko/cats/pixel`.

   This keeps the wall zero-dependency, as `wall/README.md` promises, and still gives one source of truth.
2. **The coat is a cosmetic slot**, so the five slots are `coat`, `hat`, `face`, `neck` and `held`.
   - `coat` is always equipped. The other four may be empty.
   - **Starter cosmetics are owned by everyone, with no `customer_cosmetics` row**, so a starter added later needs no backfill.
   - `customer_cosmetics` holds only bought items.
3. **The starter catalogue** *(Julius to review the art and prices; the first catalogue is the spec's "left to the builder")*. At 1 point per ₱10 a regular earns about 12–18 points a visit, so a first hat takes 2–4 visits.

   | Slot | Starter (0 pts) | Shop (points) |
   |---|---|---|
   | coat | `ginger`, `tabby`, `black`, `cream` | `tuxedo` 60, `white` 60, `calico` 90, `siamese` 120 |
   | hat | — | `beanie` 40, `party-hat` 50, `visor` (Kennko blue barista visor) 60, `flower-crown` 80, `crown` 150 |
   | face | — | `blush` 30, `round-glasses` 40, `sunnies` 60 |
   | neck | — | `bandana` (amber) 30, `bow-tie` 40, `bell-collar` 50 |
   | held | — | `kennko-cup` 30, `croissant` 40, `fish` 50 |

   That is 22 rows: 4 starters and 18 for sale. The `key`s are the module's keys, and a test checks every seeded key exists in `COSMETICS` with the same slot. Admin can rename an item, reprice it or switch it off, but cannot add a key, because the art lives in code. A new cosmetic means new art plus a migration row.
4. **The check-in URL is `https://kennko.vercel.app/here`** (`CHECKIN_URL` in core). No domain exists yet; the admin code already falls back to the same host. The pull sends it as `checkin.url`, so a later domain change needs an API deploy only, never a till update. The QR encodes `${url}?c=${code}`.
5. **The wall code:**
   - `wallCode(secret, minute)` = the first 5 bytes (40 bits) of `HMAC-SHA256(key = UTF-8 of secret, message = "kennko-wall:" + minute)`, written as 8 lower-case RFC 4648 base32 characters.
   - `minute = floor(serverMs / 60000)`.
   - The secret is 32 random bytes, base64url.
   - The API accepts the codes for minute `m` and `m − 1` only, where `m` is from `deps.now()`, compared in constant time. A code for `m + 1` is refused.
   - The API generates the secret lazily on the first pull that needs it (`insert … on conflict do nothing`, then read). That avoids `pgcrypto` in the migration.
6. **The till makes the code only after it has measured the skew.** The till:
   - keeps `clockSkewMs` from its last successful API answer, persisted in kv as `checkin_skew`, so a restart while offline still works;
   - with no skew yet, or no secret, sends `checkin: null` and shows no QR;
   - sends a wall frame at each server-minute boundary, as well as on its usual triggers.
7. **Visits:**
   - `visits (customer_id pk, visit_key uuid, source, started_at, ends_at)`.
   - A check-in upserts: when the old visit has ended (`ends_at <= now`), a **new `visit_key`** and `started_at = now`; always `ends_at = greatest(ends_at, now + 90 min)` and `source = 'checkin'`.
   - A check-in is recorded even while "Show me on the wall" is off, because the customer scanned on purpose. The answer says `onWall: false`, and turning the switch on mid-visit brings the cat in at the next pull.
8. **A linked counter order only extends an active visit.** `applyCustomerLinked` (and nothing else), after linking, runs `update visits set ends_at = greatest(ends_at, now + 90 min) where customer_id = … and ends_at > now` when the cat's `show_on_wall` is on. It never starts a visit, so a customer who has never scanned the wall never appears on it. A link that arrives after the visit ended (an offline backlog) changes nothing.
9. **What the till receives:**
   - **`PullState.checkin?: { secret: string; url: string } | null`.**
   - **`PullState.visitors?: WallVisitor[]`**, where `WallVisitor = { key: string; name: string; look: CatLook; endsAt: string }`, selected as:
     - `ends_at > now`, `show_on_wall` and `not hidden_by_admin`;
     - ordered by `started_at desc`, then `customer_id`, limit `MAX_VISITORS = 12` (the most recent arrivals win).

     `key` is the random per-visit uuid. It is regenerated each visit and identifies nothing outside it, but the wall needs it to keep a walking cat the same cat.
   - **`TillCustomer.catName`** is now the cat's name, or null when the cat is hidden by admin. It is shown on the till's customer line (staff see the name the customer chose).
   - An absent key means an API from before this plan: keep the cache.
10. **Cat names:** `checkCatName(raw)` → `{ ok: true; name } | { ok: false; message }`.
    - Trim, and collapse runs of spaces.
    - 1–16 characters (counted as code points).
    - Only Unicode letters and marks, digits, spaces and `.,'!?&-` (so `Ñ` and accents pass).
    - No run of 4 or more digits (the spec's rule).
    - **At most 4 digits in all** *(Claude's call)*, so `091 712 345` cannot spell a phone number with spaces.
    - Starter names are picked at random from `STARTER_CAT_NAMES = ['Mochi','Kape','Biko','Ube','Turon','Latte','Mango','Puto']`.
11. **Join creates the cat; `ensureCat` covers the deploy gap.** `POST /v1/me/join` inserts the cat with a random starter name and a random starter coat, in the same request after the customer row. Customers who join between the migration and this API deploy (old API, no cat) get one from `ensureCat(tx, customerId)` (`insert … on conflict do nothing`). It runs inside `GET /v1/me`, `PUT /v1/me/cat`, buy and check-in, so nobody is ever without a cat.
12. **Buying:**
    - `POST /v1/me/cosmetics/:id/buy` runs in one transaction with `lockCustomer`. The cosmetic must be active and not a starter (404 `UNKNOWN_COSMETIC` / 409 `STARTER_ITEM`).
    - Already owned → **200 with no charge** (a double tap is not an error).
    - `balance < price` → 409 `NOT_ENOUGH_POINTS`.
    - Otherwise: insert the `customer_cosmetics` row and the ledger row `(delta −price, reason 'cosmetic', cosmetic_id)` in the same transaction. A price of 0 writes no ledger row (`delta <> 0`).
    - Buying does not equip.
    - The ledger gains `unique (customer_id, cosmetic_id) where reason = 'cosmetic'` as a second guard.
13. **Equipping** (`PUT /v1/me/cat { name, look, showOnWall }`):
    - every key in `look` must exist in `cosmetics` (active or not), have the slot it is put in, and be owned (starter or a row), else 409 `NOT_OWNED` / 400 `WRONG_SLOT`;
    - `coat` is required;
    - an unknown slot name → 400.

    A switched-off item stays owned and wearable; it only leaves the shop.
14. **The secret is not rotated from admin in this plan.** If it ever leaks, Julius deletes the `shop_secrets` row in SQL and the next pull creates a new one (written into the README). Sharing a photo of the QR is an accepted non-goal of the spec.
15. **Hiding a cat** (`POST /v1/customers/:id/cat/hidden { hidden }`, owner or manager) sets `hidden_by_admin`. The customer's account page says "Kennko has paused your cat on the wall for now." Renaming does not clear it. Hidden cats drop out of the pull at once, and their name is withheld from the till's customer line.
16. **The wall draws visitors in the room's free floor space.**
    - `VISIT_SPOTS`: 12 fixed feet positions in `logic.mjs`, kept clear of the counter, the tables and their seats, with a test.
    - `assignSlots` (existing) keeps each `key` on its spot.
    - A new visitor walks in from the door, a gone or expired one walks out, and each wears its look via `drawCat`.
    - Names are DOM tags (`class="tag visitor"`, set with `textContent`).
    - The QR sits in the bottom-right corner on a white card with "Scan to bring your cat in". It is hidden when `checkin` is null.
    - Visitors and the QR appear only with `--pos`; the self-running cafe and orders mode are unchanged.

## Review Focus

1. **Spending is safe:**
   - a purchase below the price is refused and writes nothing;
   - a double buy charges once;
   - the balance check and the insert sit under one customer lock;
   - cosmetics are never priced in pesos.

   Tests in Task 4.
2. **Ownership is enforced server-side:** an equipped key that isn't owned, isn't real, or is in the wrong slot is refused (Task 4).
3. **The wall code:**
   - accepted for the current and the previous minute only;
   - the till and the API compute the same code (one core function);
   - the till uses server time;
   - the secret never reaches the wall, the tablets or the backup.

   Tests in Tasks 2, 5 and 8.
4. **Privacy:**
   - the pull's `visitors` and the wall feed carry exactly `key, name, look, endsAt`;
   - no display name, email, card code, customer id or balance;
   - account deletion removes the cat, cosmetics and visit.

   Tests in Tasks 4, 5, 8 and 9.
5. **Every app keeps working when deployed alone, in order** (migration → API → website → till + wall):
   - the migration is additive and backfills cats;
   - the old API ignores the new tables, and `ensureCat` heals customers who join in between;
   - the old website ignores the new `/v1/me` keys;
   - an old till ignores `checkin`/`visitors`;
   - a new till against an old API sees no `checkin` (no QR) and no `visitors`;
   - an old wall ignores the new feed keys.

---

### Task 1: `packages/cats` — the pixel cat and cosmetics as one plain-JS module

**Files:**
- Create: `packages/cats/src/pixel-cats.js`, `packages/cats/src/pixel-cats.d.ts`, `packages/cats/test/pixel-cats.test.mjs`, `wall/public/scene/cats.mjs` (generated), `wall/test/cats-copy.test.mjs`
- Modify:
  - `packages/cats/package.json`: `exports["./pixel"]`, with `types`, and `"test": "node --test test/*.test.mjs"`;
  - `packages/cats/scripts/export-wall-svgs.tsx`: also copies `pixel-cats.js` to `wall/public/scene/cats.mjs`;
  - `wall/public/scene/sprites.mjs`: re-export from `./cats.mjs`;
  - `wall/README.md` ("Look");
  - `packages/cats/tsconfig.json`: `allowJs`, includes `test`.

**Interfaces (`pixel-cats.js`):**
- Moved unchanged from `sprites.mjs`: `INK`, `CAT_FRONT`, `CAT_W = 14`, `CAT_H = 16`, `COAT_COLOURS` (the 8 coats), `drawLoaf`.
- `SLOTS = ['coat','hat','face','neck','held']`.
- `COSMETICS: Record<string, { slot: 'hat'|'face'|'neck'|'held'; rows: string[]; dx: number; dy: number; colours: Record<string,string> }>`. These are the 18 non-coat keys of Ruling 3, each a small character map drawn over the cat at `(dx, dy)`.
- `COAT_KEYS = Object.keys(COAT_COLOURS)`.
- `isKnownKey(slot, key): boolean`.
- `drawCat(ctx, x, y, look, o = {})`:
  - `look` is a coat name (the wall's existing calls keep working) or `{ coat, hat?, face?, neck?, held? }`;
  - draw order: body (coat palette, `o.apron` and `o.blink` as today), then neck, face, hat, held;
  - `o.flip` mirrors the overlays too;
  - an unknown key is skipped (a newer catalogue on an older wall draws the cat without it);
  - `o.rows` clips overlays to the drawn rows.
- `catBounds(look)`: `{ x0, y0, x1, y1 }` around the cat with its overlays, so the website can size its canvas (hats can rise above row 0, and held items can reach past column 13).
- `.d.ts`: `type CatLook = { coat: string; hat?: string; face?: string; neck?: string; held?: string }`, plus declarations for the above (with `ctx: CanvasRenderingContext2D`).

- [ ] **Step 1: Write `pixel-cats.test.mjs`**, using a recording fake ctx that stores `fillRect` calls with `fillStyle`:
  - `drawCat(ctx, 0, 0, 'ginger')` paints exactly the pixels `sprites.mjs` painted before the move. Pin the count and a hash of `(x,y,colour)` taken from the old implementation before deleting it.
  - For every cosmetic key: drawing `{coat:'ginger', [slot]: key}` adds at least one pixel, and every pixel lies within `catBounds`.
  - `flip: true` mirrors every overlay pixel around the cat's centre column.
  - An unknown hat key paints the same pixels as no hat.
  - Every `COSMETICS` entry's `slot` is one of the four non-coat slots, and the rows are rectangular.
  - The module has no `import` statement and touches no `document`/`window` (read its source text).
- [ ] **Step 2: Write `wall/test/cats-copy.test.mjs`:** when `../../packages/cats/src/pixel-cats.js` exists, it equals `wall/public/scene/cats.mjs` byte for byte; otherwise the test is skipped with a note. The failure message says to run `npm run export-wall -w @kennko/cats`.
- [ ] **Step 3: Run** `npm test -w @kennko/cats` and `node --test wall/test/*.test.mjs` and confirm they FAIL.
- [ ] **Step 4: Implement.** Draw the 18 overlays in the wall's palette (`INK`, `#0055ff`, `#ffb830`, white, plus a few item colours). Run the export, make `sprites.mjs` re-export, and check the wall by eye (`npm run wall`).
- [ ] **Step 5: Run** root `npm test` + `npm run typecheck` + `KENNKO_API_URL= npm run build -w @kennko/web` and confirm they PASS. The web build proves Next can import the `.js` + `.d.ts` pair.
- [ ] **Step 6: Commit** `feat(cats): one plain-JS pixel cat module with cosmetic overlays, shared by the wall (copied) and the website`

---

### Task 2: Core — cat names, looks, the wall code, visitor and pull types

**Files:**
- Create: `packages/core/src/cats.ts`, `packages/core/src/cats.test.ts`
- Modify: `packages/core/src/sync.ts` (`PullState`, `TillCustomer` doc), `packages/core/src/views.ts` (`MeView.customer.cat`, `owned`; `CosmeticView`; `CustomerDetail.cat`), `packages/core/src/index.ts`, `packages/core/src/sync.test.ts`

**Interfaces (`cats.ts`):**
- Constants:
  - `COSMETIC_SLOTS = ['coat','hat','face','neck','held'] as const` and `type CosmeticSlot`;
  - `STARTER_COATS = ['ginger','tabby','black','cream']`, `STARTER_CAT_NAMES` (Ruling 10);
  - `CAT_NAME_MAX = 16`, `VISIT_MS = 5_400_000`, `MAX_VISITORS = 12`, `CHECKINS_PER_MINUTE = 6`;
  - `CHECKIN_URL = 'https://kennko.vercel.app/here'`, `WALL_CODE_LENGTH = 8`.
- `type CatLook = { coat: string } & Partial<Record<'hat'|'face'|'neck'|'held', string>>`.
- `parseLook(x: unknown): CatLook | null`: an object with only slot keys, string values of 1–40 chars, `coat` present.
- `checkCatName(raw: string): { ok: true; name: string } | { ok: false; message: string }` (Ruling 10). Messages: "Up to 16 letters or numbers.", "Letters, numbers, spaces and . , ' ! ? & - only.", "Too many numbers in a row." and "No more than 4 numbers."
- `wallMinute(serverMs: number): number`.
- `wallCode(secret: string, minute: number): Promise<string>` (Ruling 5), using `globalThis.crypto.subtle`.
- `checkinLink(url: string, code: string): string` → `${url}?c=${code}`.
- `type WallVisitor = { key: string; name: string; look: CatLook; endsAt: string }`, and `isWallVisitor(x): x is WallVisitor`, which requires **exactly** those four keys.
- `sync.ts`: `PullState.checkin?: { secret: string; url: string } | null` and `PullState.visitors?: WallVisitor[]`.
- `views.ts`:
  - `MeView.customer` gains `cat: { name: string; look: CatLook; showOnWall: boolean; hiddenByAdmin: boolean; visitEndsAt: string | null }` and `owned: string[]`;
  - `CosmeticView = { id; key; slot: CosmeticSlot; name; pricePoints: number; isStarter: boolean; isActive: boolean; sortOrder: number }`;
  - `CustomerDetail.cat: { name; look; showOnWall; hiddenByAdmin } | null`.

- [ ] **Step 1: Write `cats.test.ts`:**
  - `checkCatName`:
    - `'  Mochi   Bun '` → `'Mochi Bun'`;
    - `'Niño'` ok;
    - 17 characters refused;
    - `''` refused;
    - `'<b>'` refused;
    - `'Cat 202'` ok;
    - `'Cat 2025'` refused (a run of 4 is longer than 3);
    - `'R2 D2 C3'` ok;
    - `'091 712 345'` refused (9 digits in all);
    - an emoji is refused.
  - **"wall code accepted for the current and previous minute only", core half:**
    - `wallCode` is deterministic, 8 characters from `[a-z2-7]`;
    - a known vector for `secret = 'test-secret'`, minute `29_000_000`, is pinned in the test;
    - consecutive minutes differ;
    - different secrets differ.
  - `wallMinute(60_000 * 5 + 59_999)` → 5.
  - `parseLook`:
    - missing coat → null;
    - an extra key `tail` → null;
    - a number value → null;
    - a valid look round-trips.
  - `isWallVisitor`: an extra `customerId` key → false; a missing `endsAt` → false.
- [ ] **Step 2: Run** `npm test -w @kennko/core` and confirm it FAILS.
- [ ] **Step 3: Implement.** Export from `index.ts`. The new `MeView`/`PullState` fields are required where the API now always sends them (`cat`, `owned`) and optional in `PullState`. Fix the compile errors in the web's `me.ts` tests by adding the fields to fixtures.
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` and confirm they PASS.
- [ ] **Step 5: Commit** `feat(core): cat names, looks, the minute wall code, visitor and pull types`

---

### Task 3: Migration 0020 — cosmetics, cats, visits, shop secret, starter cats for existing customers

**Files:**
- Create: `apps/api/supabase/migrations/0020_cats_and_visits.sql`, `apps/api/test/cats-schema.test.ts`
- Modify: `apps/api/test/migrations.test.ts` (if it lists files), `apps/api/package.json` (devDependency `@kennko/cats: "*"`, for the key test only)

**Interfaces (the SQL):**
- **`cosmetics`:**
  - `id uuid primary key default gen_random_uuid()`;
  - `key text not null unique check (key ~ '^[a-z][a-z-]{1,39}$')`;
  - `slot text not null check (slot in ('coat','hat','face','neck','held'))`;
  - `name text not null check (char_length(name) between 1 and 40)`;
  - `price_points int not null check (price_points >= 0)`;
  - `is_starter boolean not null default false`, `is_active boolean not null default true`, `sort_order int not null default 0`;
  - check `not is_starter or price_points = 0`.
  - Seeded with the 22 rows of Ruling 3, with `sort_order` in table order.
- **`customer_cosmetics`:** `customer_id uuid references customers(id) on delete cascade`, `cosmetic_id uuid references cosmetics(id)`, `acquired_at timestamptz not null`, `primary key (customer_id, cosmetic_id)`.
- **`cats`:**
  - `customer_id uuid primary key references customers(id) on delete cascade`;
  - `name text not null check (char_length(name) between 1 and 16)`;
  - `equipped jsonb not null check (jsonb_typeof(equipped) = 'object' and equipped ? 'coat')`;
  - `show_on_wall boolean not null default true`;
  - `hidden_by_admin boolean not null default false`, `hidden_by uuid references staff(id)`, `hidden_at timestamptz`;
  - `updated_at timestamptz not null`.
- **`visits`:**
  - `customer_id uuid primary key references customers(id) on delete cascade`;
  - `visit_key uuid not null`;
  - `source text not null check (source in ('checkin','counter'))`;
  - `started_at timestamptz not null`, `ends_at timestamptz not null`;
  - check `ends_at > started_at`;
  - index `visits_active_idx (ends_at)`.
- **`shop_secrets`:** `id int primary key check (id = 1)`, `checkin_secret text not null check (char_length(checkin_secret) >= 40)`, `rotated_at timestamptz not null`. No row is inserted (Ruling 5).
- **`points_ledger`:**
  - add `constraint points_ledger_cosmetic_fk foreign key (cosmetic_id) references cosmetics(id)`;
  - check `reason <> 'cosmetic' or cosmetic_id is not null`;
  - unique index `points_once_per_cosmetic on points_ledger (customer_id, cosmetic_id) where reason = 'cosmetic'`.
- **Backfill** (Plan 7 ruling): `insert into cats (customer_id, name, equipped, updated_at) select id, <name>, jsonb_build_object('coat', <coat>), now() from customers on conflict do nothing`.
  - `<name>` is `(array['Mochi',…])[1 + mod(hashtext(public_code)::bigint + 2147483648, 8)::int]`;
  - `<coat>` is picked the same way from the 4 starter coats (on `hashtext(public_code || 'coat')`).
  - `now()` is fine in a migration.
- **RLS and grants:**
  - enable RLS on the five tables; `revoke all … from anon, authenticated`;
  - `kennko_api` gets:
    - `cosmetics` select, update;
    - `customer_cosmetics` select, insert;
    - `cats` select, insert, update;
    - `visits` select, insert, update;
    - `shop_secrets` select, insert;
  - one `to kennko_api` policy per granted command. The cascades from `customers` need no DELETE grant.

- [ ] **Step 1: Write `cats-schema.test.ts`** (PGlite). Apply migrations up to 0019, seed two customers, then apply 0020, so the backfill is tested against existing rows:
  - **"starter cat for every existing customer"**: both customers have a cat with a name from the list and a starter coat; re-running the backfill statement adds nothing.
  - **The catalogue matches the art:** every seeded key exists in `@kennko/cats/pixel` (`COAT_COLOURS` for `coat`, `COSMETICS[key].slot` otherwise). The starter coats equal core `STARTER_COATS`. 22 rows, 4 starters, all starters priced 0.
  - A cosmetic with `is_starter` and price 10 fails; a negative price fails.
  - A cat without `coat` in `equipped` fails; a 17-character name fails.
  - A `'cosmetic'` ledger row without `cosmetic_id` fails, and a second one for the same customer and cosmetic fails.
  - A second `shop_secrets` row (id 2) fails.
  - Deleting the `auth.users` row cascades to the cat, `customer_cosmetics`, the visit and the cosmetic ledger rows.
  - `has_table_privilege`:
    - `kennko_api` has exactly the grants above (and no DELETE on the five);
    - `anon` and `authenticated` have no SELECT on any of them.
- [ ] **Step 2: Run** `npm test -w @kennko/api -- cats-schema` and confirm it FAILS.
- [ ] **Step 3: Write the migration.** It must be safe on the live database: additive, `if not exists` where Postgres allows it, and the backfill idempotent.
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` and confirm they PASS.
- [ ] **Step 5: Commit** `feat(db): cosmetics catalogue, cats, visits, shop secret; a starter cat for every existing customer`

---

### Task 4: API — cats, the catalogue, buying, equipping

**Files:**
- Create: `apps/api/src/loyalty/cats.ts`, `apps/api/src/routes/cosmetics.ts`, `apps/api/test/cats.test.ts`
- Modify:
  - `apps/api/src/routes/me.ts`: `readMe` gains `cat` and `owned`; join creates the cat; `PUT /cat`; `POST /cosmetics/:id/buy`;
  - `apps/api/src/create-app.ts`: `/v1/cosmetics`;
  - `apps/api/test/me-account.test.ts`: deletion leaves no cat, cosmetic row or visit;
  - `apps/api/test/sync-as-api-role.test.ts`.

**Interfaces (`loyalty/cats.ts`):**
- `ensureCat(tx, customerId, pick?: { randomInt })`: `insert … on conflict do nothing` with a random starter name and coat (Ruling 11).
- `ownedKeys(tx, customerId): Promise<string[]>`: all starter keys plus the bought keys, sorted.
- `readCat(tx, customerId, now)`: `MeView['customer']['cat']`. `visitEndsAt` is the visit's `ends_at` when it is later than `now`.
- `saveCat(tx, customerId, input: { name: string; look: unknown; showOnWall: boolean }, now): Promise<Failure | null>`, which checks:
  1. `checkCatName`;
  2. `parseLook` (400 `BAD_LOOK`);
  3. each key's slot (400 `WRONG_SLOT`);
  4. ownership (409 `NOT_OWNED`).

  Then it updates under `lockCustomer`.
- `buyCosmetic(tx, customerId, cosmeticId, now): Promise<{ kind: 'bought' | 'owned' } | Failure>` (Ruling 12). It locks first, then reads `balance`.
- `Failure = { status; code; message }`, as in `loyalty/admin.ts`.
- Routes:
  - `GET /v1/cosmetics` (public): the active cosmetics as `CosmeticView[]`, ordered by slot (in `COSMETIC_SLOTS` order) and `sort_order`, with `cache-control: public, max-age=60`;
  - `PUT /v1/me/cat` → `MeView`;
  - `POST /v1/me/cosmetics/:id/buy` → `MeView`. A non-uuid id → 404. Without a card → 404 `NOT_JOINED`.

- [ ] **Step 1: Write `cats.test.ts`:**
  - **"a purchase refused below the price"** (spec must-have): a customer with 39 points buys the 40-point `beanie` → 409 `NOT_ENOUGH_POINTS`. No `customer_cosmetics` row and no ledger row are written, and the balance is still 39. At 40 points → 200, `owned` includes `beanie`, and the balance is 0 with one `cosmetic` row of −40.
  - **Double buy:** two buys of the same item → both 200, charged once. Under `Promise.all`, PGlite runs them in turn; the lock plus the unique index guard real Postgres.
  - A negative balance (a reversal after spending, Plan 7) → any priced item refused.
  - Buying a starter → 409 `STARTER_ITEM`; an inactive item → 404; an unknown uuid → 404.
  - **"an equipped cosmetic that isn't owned is refused"** (spec must-have): `PUT /v1/me/cat` with `hat: 'crown'` not bought → 409 `NOT_OWNED`, and the cat is unchanged. After buying it → 200.
    - `coat: 'siamese'` not bought → 409;
    - `coat: 'tabby'` (starter) → 200;
    - `hat: 'bandana'` → 400 `WRONG_SLOT`;
    - `hat: 'nope'` → 409 `NOT_OWNED` (unknown counts as not owned);
    - a look without `coat` → 400.
  - Names: `'Cat 2025'` → 400 with the core message; `'  Mochi  '` is saved as `'Mochi'`.
  - A deactivated item already owned can still be equipped, and is no longer in `GET /v1/cosmetics`.
  - **Join** gives a cat with a starter name and coat, and `owned` equals the 4 starter coats.
  - A customer row inserted without a cat (the old-API gap) → `GET /v1/me` returns a cat.
  - `GET /v1/cosmetics` needs no token and has no `customer` data.
  - **Deletion** (extend `me-account.test.ts`): after a purchase, an equip and a check-in row, `DELETE /v1/me` leaves no row in `cats`, `customer_cosmetics`, `visits` or `points_ledger` for the id.
- [ ] **Step 2: Extend `sync-as-api-role.test.ts`:** catalogue, join with a cat, buy, equip, and `GET /v1/me`, as `kennko_api`.
- [ ] **Step 3: Run** `npm test -w @kennko/api -- cats me-account sync-as-api-role` and confirm it FAILS.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** root `npm test` + `npm run typecheck` + `npm run build -w @kennko/api` and confirm they PASS.
- [ ] **Step 6: Commit** `feat(api): Kennko cats — catalogue, buy with points under the customer lock, equip only what is owned`

---

### Task 5: API — wall check-in, visits, the pull's secret and visitors

**Files:**
- Create: `apps/api/src/loyalty/visits.ts`, `apps/api/src/routes/checkin.ts`, `apps/api/test/checkin.test.ts`
- Modify:
  - `apps/api/src/sync/pull.ts`: `checkin`, `visitors`;
  - `apps/api/src/loyalty/customers.ts`: `tillCustomer.catName` (Ruling 9);
  - `apps/api/src/sync/loyalty-events.ts`: `applyCustomerLinked` extends an active visit (Ruling 8);
  - `apps/api/src/create-app.ts`: `/v1/checkin`;
  - `apps/api/test/till-customers.test.ts`: the allowlist now expects a string `catName`;
  - `apps/api/test/sync-loyalty.test.ts`;
  - `apps/api/test/sync-as-api-role.test.ts`.

**Interfaces:**
- `visits.ts`:
  - `checkinSecret(sql): Promise<string>`: reads row 1, or inserts `randomBytes(32).toString('base64url')` with `on conflict do nothing` and reads again.
  - `codeMatches(secret, code, now): Promise<boolean>`: compares with `wallCode` for `wallMinute(now)` and the minute before it, using `timingSafeEqual` on equal-length buffers.
  - `startOrExtendVisit(tx, customerId, now)` (Ruling 7).
  - `extendActiveVisit(tx, customerId, now)` (Ruling 8, only when `show_on_wall`).
  - `readVisitors(sql, now): Promise<WallVisitor[]>` (Ruling 9). It selects `visit_key, cats.name, cats.equipped, ends_at` by an explicit column list and maps each row through `parseLook` (a row whose look fails is skipped).
- `POST /v1/checkin` (`requireUser`) `{ code: string }`:
  1. `hit('checkin:'+userId, CHECKINS_PER_MINUTE)` false → 429 `RATE_LIMITED`;
  2. no customer row → 404 `NOT_JOINED`;
  3. a code that is not 8 base32 characters, or matches neither minute → 400 `BAD_WALL_CODE` ("That code has changed. Scan the wall again.");
  4. otherwise, in one transaction: `lockCustomer`, `ensureCat`, `startOrExtendVisit`.

  It answers `{ endsAt, onWall: show_on_wall && !hidden_by_admin }`, with `no-store`.
- Pull: `checkin: { secret: await checkinSecret(sql), url: CHECKIN_URL }`, `visitors: await readVisitors(sql, now)`.

- [ ] **Step 1: Write `checkin.test.ts`** (`deps.now` pinned at `T` = minute `m` + 30 s; the secret is read from the DB after the first pull):
  - **"wall code accepted for the current and previous minute only"** (spec must-have):
    - `wallCode(secret, m)` at `T` → 200;
    - the same code at `T + 60 s` (minute `m + 1`) → 200;
    - at `T + 120 s` → 400 `BAD_WALL_CODE`;
    - `wallCode(secret, m + 1)` at `T` → 400 (no future minute);
    - a code made with another secret → 400;
    - garbage (`'../..'`, 40 characters) → 400.
  - **Visits:**
    - the first check-in creates a visit ending `T + 90 min`;
    - a check-in 30 minutes later moves `ends_at` to `T + 120 min` and keeps `visit_key` and `started_at`;
    - a check-in after the visit ended gives a new `visit_key` and `started_at`.
  - The 7th check-in in a minute → 429, even with a valid code.
  - No card → 404; no token → 401.
  - "Show me on the wall" off → 200 with `onWall: false`, a visit row exists, and the visitor is not in the pull; switched on → in the next pull. A cat hidden by admin → not in the pull.
  - **Counter link** (in `sync-loyalty.test.ts`):
    - `customer.linked` for a customer with an active visit extends `ends_at` to `now + 90 min`;
    - with no visit, none is created;
    - with `show_on_wall` off, nothing is extended;
    - with an ended visit, nothing changes.
  - **The 12-cat cap:** 14 active visits → the pull has 12, the newest `started_at` first; expired visits are never included.
  - **"nothing beyond the allowed fields sent to the till"** (spec must-have, extending Plan 7's allowlist test). Seed a customer named `Ana Reyes` (`ana@x.test`, code known, 120 points), with a cat `Mochi` wearing a bought hat and a visit. Then:
    - every `visitors[]` entry has keys exactly `['endsAt','key','look','name']`, and `look` keys are a subset of the slots;
    - `JSON.stringify(pull.visitors)` contains neither `Ana Reyes`, `ana@x.test`, the customer id nor the card code;
    - `checkin` keys are exactly `['secret','url']`;
    - `TillCustomer` keys are unchanged and `catName === 'Mochi'`, and null once the cat is hidden.
- [ ] **Step 2: Extend `sync-as-api-role.test.ts`:** check-in, and a pull that creates the secret, with visitors and the counter-link extension, as `kennko_api`. This catches a missing `shop_secrets` insert grant.
- [ ] **Step 3: Run** `npm test -w @kennko/api -- checkin sync-loyalty till-customers sync-as-api-role` and confirm it FAILS.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** root `npm test` + `npm run typecheck` + `npm run build -w @kennko/api` and confirm they PASS.
- [ ] **Step 6: Commit** `feat(api): wall check-in with the minute code, 90-minute visits, the pull carries the secret and up to 12 visiting cats`

---

### Task 6: API admin — hide a cat, the cosmetics catalogue

**Files:**
- Modify:
  - `apps/api/src/loyalty/admin.ts`: `customerDetail` gains `cat`; `setCatHidden`;
  - `apps/api/src/routes/customers.ts`: `POST /:id/cat/hidden`;
  - `apps/api/src/routes/cosmetics.ts`: admin list and patch;
  - `apps/api/test/customers-admin.test.ts`, `apps/api/test/sync-as-api-role.test.ts`.

**Interfaces:**
- `POST /v1/customers/:id/cat/hidden` (`requireStaff(deps, 'manager')`) `{ hidden: boolean }`: sets `hidden_by_admin`, `hidden_by` and `hidden_at`, and answers the `CustomerDetail`.
- `GET /v1/cosmetics/all` (`requireStaff(deps, 'owner')`): every row, inactive included, as `CosmeticView[]`.
- `PATCH /v1/cosmetics/:id` (owner) `{ name?, pricePoints?, isActive?, sortOrder? }`:
  - `pricePoints` is an integer from 0 to 10 000;
  - a starter's price stays 0 (409 `STARTER_ITEM`);
  - a starter cannot be switched off (409), so no cat is left without a free coat.

  `key` and `slot` are not editable (Ruling 3).

- [ ] **Step 1: Extend `customers-admin.test.ts`:**
  - a manager hides a cat → the pull drops its visitor and the detail shows `hiddenByAdmin: true`;
  - a barista → 403;
  - unhide restores it.
  - Catalogue:
    - the owner reprices `crown` to 120 → `GET /v1/cosmetics` shows 120, and a purchase charges 120;
    - a manager PATCH → 403;
    - a negative price → 400;
    - repricing a starter → 409;
    - switching off `fish` hides it from the shop and keeps it equipped on a cat that owns it.
- [ ] **Step 2: Extend `sync-as-api-role.test.ts`** (hide and patch as `kennko_api`, proving the `cosmetics` update grant).
- [ ] **Step 3: Run** the tests and confirm they FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** root `npm test` + `npm run typecheck` and confirm they PASS.
- [ ] **Step 6: Commit** `feat(api): admin hides a cat from the wall; owner keeps the cosmetics catalogue`

---

### Task 7: Website — the cat customiser and cosmetics shop on the account page

**Files:**
- Create:
  - `apps/web/components/account/CatCanvas.tsx` (client): draws a `CatLook` with `@kennko/cats/pixel` at an integer scale;
  - `apps/web/components/account/CatCustomiser.tsx` (client);
  - `apps/web/app/account/cat-actions.ts`: server actions `saveCat`, `buyCosmetic`;
  - `apps/web/app/account/cat.ts`: pure helpers;
  - `apps/web/app/account/cat.test.ts`, `apps/web/app/account/cat-actions.test.ts`.
- Modify: `apps/web/app/account/page.tsx` ("Your cat" section under the stamp card), `apps/web/app/account/account.css`, `apps/web/lib/api/client.ts` (a public fetch for `/v1/cosmetics`, if missing).

**Interfaces:**
- `cat.ts`:
  - `shopRows(catalogue: CosmeticView[], owned: string[], points: number)` → per slot, `{ key, name, price, state: 'equippable' | 'buy' | 'short' }`, where `short` is "N more points";
  - `draftLook(look, slot, key | null)`: `coat` cannot be cleared.
- `CatCanvas`:
  - `<canvas>` sized from `catBounds(look)` × scale, redrawn on change, with `imageSmoothingEnabled = false`;
  - `role="img"` and `aria-label="{name}, a {coat} cat wearing …"`.
- `CatCustomiser`:
  - the preview;
  - a name field with live `checkCatName` feedback;
  - slot tabs (Coat, Hat, Face, Neck, Held), each a grid of owned items (tap to try on) and shop items with their price in points ("Buy for 40 points", with a confirm step), plus "None" for the four optional slots;
  - the "Show me on the wall" switch;
  - Save.

  It shows the balance, and the pause note when `hiddenByAdmin` (Ruling 15). While a visit is active: "Your cat is at Kennko until 3:40 PM".
- `cat-actions.ts`: `saveCat(form)` → `PUT /v1/me/cat` and `buyCosmetic(id)` → `POST /v1/me/cosmetics/:id/buy`. Each maps the API's `code` to friendly copy (`NOT_ENOUGH_POINTS` → "You need N more points.", `NOT_OWNED` → "Buy it first.") and revalidates `/account`.

- [ ] **Step 1: Write `cat.test.ts`:**
  - `shopRows`:
    - a starter is equippable;
    - an unowned item with 39 of 40 points is `short` with "1 more point";
    - with 40 it is `buy`;
    - owned items are equippable;
    - slots come in the core order.
  - `draftLook` cannot clear `coat` and can clear `hat`.
- [ ] **Step 2: Write `cat-actions.test.ts`** (mock `userFetch`, as `actions.test.ts` does): the error mapping for 409 `NOT_ENOUGH_POINTS`, 409 `NOT_OWNED`, 400 name; success revalidates.
- [ ] **Step 3: Run** `npm test -w @kennko/web -- cat` and confirm it FAILS.
- [ ] **Step 4: Implement** in the sticker style: a white card, ink keyline, blue primary button, amber price chips, no prices in pesos.
- [ ] **Step 5: Run** root `npm test` + `npm run typecheck` + `KENNKO_API_URL= npm run build -w @kennko/web` and confirm they PASS. Visual check at 375, 768, 1024 and 1440 px: the cat stays crisp, and the tabs wrap on a phone.
- [ ] **Step 6: Commit** `feat(web): name and dress your Kennko cat; buy cosmetics with points`

---

### Task 8: Till — the check-in secret, the minute code in server time, visitors in the wall feed

**Files:**
- Create: `apps/pos/server/checkin.ts`, `apps/pos/test/checkin.test.ts`
- Modify:
  - `apps/pos/server/store.ts`: a `visitors` table, kv keys, `replaceVisitors`, `activeVisitors`, `clearCheckin`, and the snapshot scrub;
  - `apps/pos/server/sync.ts`: accept and apply `checkin`/`visitors` in `isPullState`, and persist the skew;
  - `apps/pos/server/device.ts` and `apps/pos/server/index.ts`: revoke and forget clear the secret and visitors; the minute-aligned wall frame;
  - `apps/pos/server/wall-feed.ts`: `checkin`, `visitors`;
  - `apps/pos/src/loyaltyText.ts`: `customerLine` leads with the cat name when there is one;
  - `apps/pos/package.json`: `qrcode`, `@types/qrcode`;
  - `apps/pos/test/wall-feed.test.ts`, `apps/pos/test/sync.test.ts`, `apps/pos/test/backup.test.ts`, `apps/pos/test/loyaltyText.test.ts`;
  - `apps/pos/README.md`: a "Cats on the wall" section.

**Interfaces:**
- SQLite: `visitors (key text primary key, data text not null, ends_at integer not null)`. kv: `checkin_secret`, `checkin_url`, `checkin_skew`.
- `store.ts`:
  - `replaceVisitors(list: WallVisitor[])`: entries failing `isWallVisitor` are skipped, and at most `MAX_VISITORS` are kept;
  - `activeVisitors(now): WallVisitor[]`: `ends_at > now`, in pull order;
  - `setCheckin(c: { secret; url } | null)`, `checkinConfig()`, `clearCheckin()` (secret, URL and visitors).
  - `snapshot()` deletes `visitors` and the `checkin_secret` kv row from the backup copy.
- `sync.ts`:
  - `isPullState` accepts `checkin` as missing, null, or `{ secret: string ≥ 40 chars, url: https string }`, and `visitors` as missing or an array;
  - applying: `checkin` present → `setCheckin`, absent → keep; `visitors` present → `replaceVisitors`, absent → keep;
  - after each answer that set `clockSkewMs`, `kvSet('checkin_skew', …)`.
- `checkin.ts`:
  - `currentCheckin(store, now: number): Promise<{ url: string; modules: string[]; minute: number } | null>`: null without a secret or a skew. It uses `wallMinute(now + skew)`, `wallCode`, `checkinLink`, and `QRCode.create(link, { errorCorrectionLevel: 'M' }).modules` turned into rows of `'0'`/`'1'`. Memoised per minute.
  - `msToNextMinute(now, skew)`.
- `wall-feed.ts`:
  - `wallSnapshot(store, menu, now, checkin)` takes the `checkin` precomputed by `currentCheckin` (it stays synchronous);
  - it adds `checkin: { url, modules } | null` and `visitors: { key, name, look, endsAt: number }[]`, built field by field from `activeVisitors` (`endsAt` as ms, the till's own clock corrected by the skew, so the wall drops a cat on time).
- `index.ts`: a `setTimeout` chain fires at each server minute (`msToNextMinute` + 50 ms) and re-sends the wall frame. The tablets' feed is unchanged and never carries `checkin`.

- [ ] **Step 1: Write `checkin.test.ts`:**
  - with no secret → null;
  - with a secret and no skew → null;
  - with skew `+90 000` ms the code equals `wallCode(secret, wallMinute(now + 90 000))`, not the till's own minute (server time);
  - the URL is `${url}?c=<8 chars>`;
  - `modules` is square, rows of `0`/`1`, size ≥ 25;
  - the next minute gives a different code;
  - `msToNextMinute` is correct with a negative skew.
- [ ] **Step 2: Extend the existing tests:**
  - `sync.test.ts`:
    - a pull with `checkin` and `visitors` stores them;
    - a pull without the keys keeps them;
    - `checkin: { secret: 'short' }` garbles the pull;
    - revoke clears the secret and visitors;
    - the skew is persisted.
  - `backup.test.ts`: the backup copy has no `visitors` rows and no `checkin_secret`.
  - **`wall-feed.test.ts`, "nothing beyond the allowed fields sent to the wall"** (spec must-have):
    - with a stored secret, two visitors (one expired) and a linked, stamped order, `JSON.stringify(wallSnapshot(...))` does not contain the secret;
    - `checkin` keys are exactly `['modules','url']`;
    - `visitors` has one entry with keys exactly `['endsAt','key','look','name']`;
    - no `KC-` code or `customerCode` appears.
  - The tablets' `/api/events` snapshot has no `checkin` or `secret`.
  - `loyaltyText.test.ts`: with `catName: 'Mochi'` → `'Mochi · KC-7F3-…-XAM · 5 of 8 stamps'`; null keeps today's line.
- [ ] **Step 3: Run** `npm test -w @kennko/pos -- checkin sync backup wall-feed loyaltyText` and confirm it FAILS.
- [ ] **Step 4: Implement.** In the README, explain:
  - the QR appears on the wall once the till has synced at least once;
  - it changes every minute;
  - offline, new check-ins wait while cats already on the wall stay until their visit ends.
- [ ] **Step 5: Run** root `npm test` + `npm run typecheck` + `npm run build -w @kennko/pos` and confirm they PASS.
- [ ] **Step 6: Commit** `feat(pos): minute wall code from the synced secret in server time; visiting cats and the QR in the wall feed, never the secret`

---

### Task 9: Wall — visiting cats with their cosmetics and names, the QR in the corner

**Files:**
- Modify:
  - `wall/pos-link.mjs`: `fromPosFeed` carries `visitors` and `checkin`;
  - `wall/public/scene/logic.mjs`: `VISIT_SPOTS`, `visitorView`;
  - `wall/public/scene/scene.mjs`: visitors;
  - `wall/public/wall.mjs`: hand visitors to the scene and draw the QR;
  - `wall/public/index.html` and `wall/public/wall.css`: the QR card;
  - `wall/test/pos-link.test.mjs`, `wall/test/logic.test.mjs`;
  - `wall/README.md`: the "Following the till" table gains the check-in rows.

**Interfaces:**
- `fromPosFeed(feed, baristas)` also returns:
  - `visitors`: each entry must have a string `key` (≤ 64 characters), a string `name` (cut to 16), a `look` object with a string `coat` and only slot keys, and a finite `endsAt`. Bad entries are dropped, never the whole feed. At most 12 are kept.
  - `checkin`: `{ url, modules }` only when `url` starts with `https://` and `modules` is a square of `0`/`1` strings, else null.

  A feed without the keys gives `visitors: []` and `checkin: null`. The orders' handling is unchanged (a bad order still returns null).
- `logic.mjs`:
  - `VISIT_SPOTS`: 12 `{ x, y, flip }` feet positions inside the room (Ruling 16);
  - `visitorView(visitors, now)`: the unexpired visitors, newest first, at most 12.
- `scene.mjs`: `sync(orders, count, initial, visitors = [])`.
  - Visitors are a second map keyed by `key`, given spots with `assignSlots`.
  - A new one walks in from `DOOR`, and one gone from the list or past `endsAt` walks out.
  - Each is drawn with `drawCat(ctx, x, y, look, { flip, blink })`, sorted with the other floor things by `y`, with a `tag visitor` label holding the name.
  - In ambient mode no visitors are drawn.
- `wall.mjs`: renders `state.checkin` into a `<canvas id="checkin">` (4-module quiet zone, white, ink modules, integer module size), with the caption "Scan to bring your cat in". Hidden when null.

- [ ] **Step 1: Extend `pos-link.test.mjs`:**
  - visitors pass through with only `key, name, look, endsAt`, so an extra `customerId` on the input is not in the output;
  - a visitor without `look.coat` is dropped and the others stay;
  - 15 visitors → 12;
  - a 30-character name → 16;
  - `checkin` with `http://` → null;
  - non-square modules → null;
  - a feed without the keys → `[]` and null;
  - the existing order tests are unchanged.
- [ ] **Step 2: Extend `logic.test.mjs`:**
  - `VISIT_SPOTS` has 12 distinct positions;
  - none is inside the counter rectangle (x 11–179, y 75–102) or within 8 px of a table seat;
  - all are inside 288 × 152;
  - `visitorView` drops expired visitors and orders the newest first.
- [ ] **Step 3: Run** `node --test wall/test/*.test.mjs` and confirm it FAILS.
- [ ] **Step 4: Implement.** Check by eye with `npm run all` (till + wall), or `npm run wall:pos` against a till fed a test pull:
  - the QR scans on a phone and opens `/here?c=…`;
  - 12 visitors fit without overlapping;
  - a visitor wearing a hat, glasses, a bandana and a cup reads clearly on the projector.
- [ ] **Step 5: Run** root `npm test` + `npm run typecheck` and confirm they PASS.
- [ ] **Step 6: Commit** `feat(wall): visiting cats walk in wearing their cosmetics, with their names; rotating check-in QR in the corner`

---

### Task 10: Website — the check-in page and the admin cat tools

**Files:**
- Create:
  - `apps/web/app/here/page.tsx`, `apps/web/app/here/actions.ts`, `apps/web/app/here/here.test.ts`;
  - `apps/web/app/admin/cosmetics/page.tsx`, `apps/web/app/admin/cosmetics/actions.ts`, `apps/web/app/admin/cosmetics/actions.test.ts`.
- Modify:
  - `apps/web/app/admin/customers/[id]/page.tsx` and `apps/web/app/admin/customers/actions.ts`: the cat preview (`CatCanvas`) and "Hide from the wall" / "Show on the wall";
  - the admin nav (owner-only "Cosmetics");
  - `apps/web/CLAUDE.md`: the admin capability table gains "Hide a cat" (manager+) and "Cosmetics catalogue" (owner).

**Interfaces:**
- `/here?c=<code>` (dynamic, `no-store`):
  - **signed out** → "Sign in to bring your cat in", with the sign-in at `/account?next=/here?c=<code>` (encoded, through `safeNextPath`);
  - **signed in without a card** → "Get your Kennko card first", linking to `/account`;
  - **with a card** → the cat preview and one button, **"Walk my cat in"**, a server action. The page load itself never checks in, so a link preview cannot start a visit.
  - After the action:
    - `onWall: true` → "Mochi is walking in. Look at the wall!" and the end time;
    - `onWall: false` → "Checked in. Your cat is set to stay home", with a link to turn on "Show me on the wall".
  - Errors:
    - `BAD_WALL_CODE` → "That code has changed. Scan the wall again.";
    - 429 → "Give it a minute and try again.";
    - a missing or malformed `c` → "Scan the QR code on the wall at Kennko."
- `here/actions.ts`: `checkIn(code)` → `POST /v1/checkin` via `userFetch`; `checkinMessage(result)` is pure.
- Admin › Cosmetics (owner): a table grouped by slot with a pixel preview, name, price (points), On/Off and order, with inline save through `PATCH /v1/cosmetics/:id`. A note says new items need new art in code.

- [ ] **Step 1: Write `here.test.ts`:**
  - `checkinMessage` for each answer;
  - code validation (`[a-z2-7]{8}` only; anything else gives the scan prompt);
  - the next path is built encoded and survives `safeNextPath`.
- [ ] **Step 2: Write `cosmetics/actions.test.ts`:** a price is sent as an integer; 409 `STARTER_ITEM` → "Starter items stay free and on."
- [ ] **Step 3: Run** `npm test -w @kennko/web -- here cosmetics` and confirm it FAILS.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** root `npm test` + `npm run typecheck` + `KENNKO_API_URL= npm run build -w @kennko/web` and confirm they PASS. Visual check of `/here` at 375 px, since it is a phone page reached from a QR.
- [ ] **Step 6: Commit** `feat(web): wall check-in page; admin hides a cat and keeps the cosmetics catalogue`

---

### Task 11: Deploy checklist

**Files:** `apps/api/README.md`, a "Plan 8" section. Nothing is run by the implementer: Julius applies the migration and deploys.

- [ ] **Step 1:** On the branch tip, run root `npm test`, `npm run typecheck`, `KENNKO_API_URL= npm run build -w @kennko/web`, `npm run build -w @kennko/api` (load `server.js` with dummy env) and `npm run build -w @kennko/pos`. Then run `npm run export-wall -w @kennko/cats` and confirm `git status` shows no change to `wall/public/scene/cats.mjs`.
- [ ] **Step 2: Write the checklist** into the README, in this order:
  1. **Migration** `0020_cats_and_visits.sql`: dry run first; expect only 0020. Afterwards:
     - `select count(*) from customers` = `select count(*) from cats` (every existing customer has a starter cat);
     - `select count(*) from cosmetics` → 22;
     - `select count(*) from shop_secrets` → 0 (the API makes it on the first pull).
  2. **API:** deploy. No new env vars. Smoke checks:
     - `GET /v1/cosmetics` → 22 items without a token;
     - `POST /v1/checkin` without a token → 401;
     - `PUT /v1/me/cat` without a token → 401.
  3. **Website:** deploy. Check `/here` without `c` (shows the scan prompt) and the account page's "Your cat" section on a phone. **Julius reviews the cosmetics art and the starter prices** (Ruling 3) in admin › Cosmetics and on a test cat before announcing. Prices can change there without a deploy.
  4. **Till and wall together** (shop computer):
     - pull, then `deploy\windows\setup.cmd` (installs `qrcode`, builds, restarts the POS and wall tasks);
     - after the first sync, `select count(*) from shop_secrets` → 1;
     - the wall shows the QR in the corner within a minute.
  5. **Live checks:**
     - Scan the wall QR with a signed-in phone that has a card, then "Walk my cat in": the cat walks onto the wall within one sync (about 15 s) with its name.
     - Buy a cosmetic with enough test points (an owner adjustment), equip it, and check it on the wall at the next pull.
     - Buying with too few points shows "You need N more points".
     - Wait over 2 minutes and reuse an old QR photo: "That code has changed".
     - Switch "Show me on the wall" off: the cat leaves at the next pull.
     - Admin hides the cat: it leaves, and the till's customer line shows no cat name.
     - Wi-Fi off on the shop computer: the QR keeps rotating and the cats stay until their visits end. A phone check-in on mobile data succeeds, and the cat appears once the till is back online.
     - Link the test customer at the counter during a visit: `select ends_at from visits` moves to about now + 90 min.
     - Delete a throwaway account with a cat, a purchase and a visit: no `cats`, `customer_cosmetics` or `visits` row is left for the id.
  6. **If the check-in secret ever leaks:** delete the `shop_secrets` row. The next pull creates a new one, and old QR photos stop working (Ruling 14).
- [ ] **Step 3: Commit** `docs(api): plan 8 deploy checklist`

## Self-review notes

- **Spec coverage, rollout step 3:**
  - `packages/cats` as one plain-JS module shared by the wall and the website ✔ (1);
  - a starter cat and coat, named by the customer ✔ (3, 4);
  - the five slots, one equipped per slot from those owned, checked by the API ✔ (2, 4);
  - cat name rules ✔ (2, 4);
  - points spent on cosmetics with `balance >= price` under the customer lock, never money, no trading ✔ (4);
  - the DB stores only keys and prices ✔ (3);
  - the customiser and shop ✔ (7);
  - the starter catalogue proposed for Julius's review ✔ (Ruling 3, 11);
  - admin hides a cat and keeps the catalogue ✔ (6, 10).
- **Spec coverage, rollout step 4:**
  - the rotating QR to `/here?c=` ✔ (8, 9, 10);
  - the code made by the till from the synced shop secret, as an HMAC of the minute truncated to 40 bits, in server time ✔ (2, 8);
  - the wall gets only the current code ✔ (8);
  - the API accepts the current and previous minute ✔ (5);
  - check-ins rate-limited per user ✔ (5);
  - one visit row per customer, `greatest(ends_at, now + 90 min)` ✔ (5);
  - a counter link extends the visit when the switch is on ✔ (5);
  - at most 12 cats, the most recent arrivals ✔ (5, 9);
  - the till pulls the name, look and end time only ✔ (5, 8);
  - the wall never talks to the internet ✔ (9);
  - "Show me on the wall" ✔ (4, 7).
- **Must-have tests in scope:**
  - a purchase refused below the price (4);
  - an equipped cosmetic that isn't owned is refused (4);
  - the wall code for the current and previous minute only (2, 5);
  - nothing beyond the allowed fields to the till (5) or the wall (8, 9);
  - deletion leaving no row (4, extending Plan 7's test).
- **Deploy-order safety:**
  - migration alone: additive, so Plan 7's API keeps working, and its join just makes no cat until `ensureCat`;
  - API next: new keys only, and the old website casts `MeView` without using `cat`;
  - website next: needs the new API (order respected);
  - till and wall last, together: the new till against the new API, and an old wall would ignore the new feed keys anyway.
- **Known limits:**
  - concurrency is exercised on PGlite one request at a time; the purchase's safety on Postgres rests on the row lock plus `points_once_per_cosmetic`;
  - a visitor's `endsAt` on the wall follows the till's clock corrected by the skew;
  - a QR photo works for about 2 minutes (an accepted non-goal);
  - the secret is rotated only by SQL (Ruling 14).
