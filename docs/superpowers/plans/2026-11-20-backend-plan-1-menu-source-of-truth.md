# Backend Plan 1: The Menu as One Source of Truth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the menu to variants and per-item option groups (food included), publish it as immutable versioned snapshots through a new `apps/api`, and make the website and the till read the menu from that one place.

**Architecture:** One additive migration restructures the menu tables in Supabase and backfills today's data plus the food items. A new Hono service (`apps/api`, Vercel) builds and serves snapshots (`GET /v1/menu`, `POST /v1/menu/publish`). The website and the till switch their menu reads to the API; admin keeps writing the tables directly and publishes after each save. A second migration drops the old tables once the website is switched.

**Tech Stack:** Hono 4, postgres.js 3 (`prepare: false`), zod 4, jose 6, vitest 4, PGlite 0.5 + `@electric-sql/pglite-socket` for database tests (no Docker on the dev Mac), Supabase Postgres, Next.js 16 (website), Node 24 (till).

**Specs:** `docs/superpowers/specs/2026-11-20-kennko-backend-design.md` (sections Architecture, Schema › Menu, API). The accounts spec (`2026-11-20-kennko-accounts-loyalty-cats-design.md`) is not touched by this plan.

### Where this plan sits

The two approved designs ship as eight plans, each leaving every app working:

| Plan | Delivers |
|---|---|
| **1 (this)** | **Menu restructure, snapshots, `apps/api` skeleton, website and till read the menu from the API** |
| 2 | Unified orders, payments, ticket numbers; online checkout and admin order actions through the API |
| 3 | Staff roles and PINs, devices and pairing |
| 4 | Till sync: outbox, push, pull, one-time `pos.db` import |
| 5 | Paid online orders in the till queue |
| 6 | Wall off `menu.json`, day report, remaining website reads off the service key |
| 7 | Customer accounts, digital stamp card, points ledger |
| 8 | Kennko cats, cosmetics, wall check-in |

## Global Constraints

- Money is integer centavos everywhere; format only at render with `formatPesos()` from `@kennko/core`.
- Use `type`, never `interface`.
- Imports inside `packages/core`, `apps/pos` and `apps/api` carry the `.ts` extension.
- Text with `check` constraints, not new Postgres enums, for any new status or kind column.
- Nothing that has been sold is hard-deleted from the menu: hide it with `is_archived`.
- Every new table has RLS enabled. `anon` and `authenticated` get only the policies listed in Task 2.
- The API connects as role `kennko_api`, never `postgres` or the service key.
- postgres.js options for the Supabase transaction pooler: `prepare: false`, `max: 1`.
- Supabase JWTs are ES256, verified against `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, audience `authenticated`.
- Run `npm test` and `npm run typecheck` from the repo root before every commit.

## Review Focus

- **Admin saves while the API is down:** tables change, no snapshot is made; the site keeps the old snapshot and checkout (still table-priced until Plan 2) answers `PRICE_CHANGED`. Expect admin to say "Saved, but not published" with a Publish button that retries. Pinned in Task 9.
- **The menu edited back to an earlier state:** its hash equals an older snapshot's. Expect a new version, not a unique-constraint error. Pinned in Task 5.
- **An item archived or a category deactivated:** gone from the next snapshot, still present in `GET /v1/menu/:version` for older versions. Pinned in Task 5.
- **Sold-out toggled:** shows in `GET /v1/menu` without a publish, with a new ETag. Pinned in Task 7.
- **No snapshot published yet (fresh deploy):** `GET /v1/menu` answers 404 `NO_MENU`; the landing page renders with an empty menu instead of crashing. Pinned in Tasks 7 and 8.

---

## File map

```
apps/api/                         NEW workspace @kennko/api
  package.json, tsconfig.json, vitest.config.ts, README.md
  supabase/migrations/            MOVED from apps/web/supabase/migrations (0001–0011), + 0012, 0013
  src/index.ts                    Vercel entry: default-exports the app
  src/app.ts                      createApp(deps)
  src/config.ts                   loadConfig(env)
  src/db.ts                       createSql(url)
  src/auth.ts                     createUserVerifier, requireStaff
  src/http.ts                     apiError, error handler
  src/menu/snapshot.ts            buildSnapshotBody, hashBody, publishMenu
  src/menu/read.ts                readLatestMenu, readMenuVersion
  src/routes/menu.ts              GET /v1/menu, GET /v1/menu/:version, POST /v1/menu/publish
  src/dev.ts                      local server (@hono/node-server)
  test/pg.ts                      startTestDb()
  test/supabase-stubs.sql         auth/storage stubs + anon/authenticated/service_role roles
  test/*.test.ts
packages/core/src/snapshot.ts     NEW snapshot types + liveDrinkMenu()
apps/web/lib/menu/api.ts          NEW fetchMenuSnapshot()
apps/web/lib/menu/publish.ts      NEW publishMenu() (server-only)
apps/web/lib/menu/queries.ts      getMenu/getFoodMenu from the snapshot
apps/web/app/admin/menu/*         variants, food single price, publish after save
apps/web/lib/orders/create.ts     reads menu_variants / options
apps/web/app/order/page.tsx       option groups from the snapshot
apps/web/components/site/FoodMenu.tsx   prop-driven
apps/web/scripts/seed-menu.ts     writes variants / option groups
apps/pos/server/menu.ts           fetchApiMenu() replaces fetchWebsiteMenu()
apps/pos/server/config.ts         api.url
```

---

### Task 1: `apps/api` workspace and the database test harness

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`
- Move: `apps/web/supabase/migrations/` → `apps/api/supabase/migrations/` (`git mv`)
- Create: `apps/api/test/supabase-stubs.sql`, `apps/api/test/pg.ts`
- Test: `apps/api/test/migrations.test.ts`
- Modify: `apps/web/CLAUDE.md` (migrations now applied from `apps/api` with `npx supabase db push`), root `README.md` table (add `apps/api`)

**Interfaces:**
- Produces: `startTestDb(): Promise<{ sql: postgres.Sql; url: string; stop(): Promise<void> }>` — fresh in-memory PGlite, stubs applied, then every file in `apps/api/supabase/migrations` in name order, served over a local socket so postgres.js connects to `url`.
- Produces: `asUser(sql, userId: string | null, fn: (tx) => Promise<T>): Promise<T>` — runs `fn` in a transaction with `set local role authenticated` (or `anon` when null) and `set local request.jwt.claim.sub = userId`, for RLS tests.

- [ ] **Step 1:** `package.json`: name `@kennko/api`, `"type": "module"`, scripts `dev` (`tsx watch src/dev.ts`), `test` (`vitest run`), `typecheck` (`tsc --noEmit`). Dependencies `hono`, `postgres`, `zod`, `jose`, `@kennko/core`; dev `@hono/node-server`, `@electric-sql/pglite`, `@electric-sql/pglite-socket`, `tsx`, `typescript`, `vitest`, `@types/node`. `npm install` from the root.
- [ ] **Step 2:** `git mv apps/web/supabase/migrations apps/api/supabase/migrations`.
- [ ] **Step 3: Write the failing test** `migrations.test.ts`:

```ts
test('every migration applies to a fresh database', async () => {
  const db = await startTestDb()
  const [{ count }] = await db.sql`select count(*)::int from menu_categories`
  expect(count).toBe(0)
  await db.stop()
})
test('anon can read a live menu item and not an archived one', async () => { /* insert category + two items as postgres, read with asUser(sql, null, ...) */ })
```

- [ ] **Step 4:** Run `npm test -w @kennko/api` — expect FAIL (`startTestDb` not defined).
- [ ] **Step 5:** Write `supabase-stubs.sql`. It needs:
  - roles `anon`, `authenticated`, `service_role` (`nologin`);
  - schemas `auth` and `storage`;
  - `auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}')`;
  - `auth.uid()`, which returns `nullif(current_setting('request.jwt.claim.sub', true), '')::uuid`;
  - `auth.role()` and `auth.jwt()`;
  - `storage.buckets` and `storage.objects`, with the columns migration 0004 uses;
  - `storage.foldername(text) returns text[]`.

  Then write `pg.ts`, which uses `PGlite` and `PGLiteSocketServer` on a free port.
- [ ] **Step 6:** Run the tests and add any stub the old migrations still need, until both tests PASS. Do not edit migrations 0001–0011.
- [ ] **Step 7:** Commit: `feat(api): add api workspace and PGlite migration harness`.

### Task 2: Migration 0012 — variants, option groups, food, snapshots

**Files:**
- Create: `apps/api/supabase/migrations/0012_menu_variants_and_snapshots.sql`
- Test: `apps/api/test/menu-schema.test.ts`

**Interfaces:**
- Produces tables, used by every later task:
  - `menu_variants(id, item_id, code, label, price_centavos, temperature, sort_order, is_archived, is_available, availability_changed_at, created_at, updated_at)`, `unique (item_id, code)`, `code ~ '^[A-Z]{1,4}$'`, `temperature in ('iced','hot','none')`;
  - `option_groups(id, name unique, min_select, max_select, sort_order)`, `check (0 <= min_select and min_select <= max_select)`;
  - `options(id, group_id, name, price_centavos, sort_order, is_archived, is_available, availability_changed_at)`, `unique (group_id, name)`;
  - `item_option_groups(item_id, group_id, sort_order, primary key (item_id, group_id))`;
  - `discount_presets(id, label, kind in ('percent','amount'), value int, is_active, sort_order)`;
  - `menu_snapshots(version bigint primary key, body jsonb not null, body_hash text not null, published_at timestamptz not null default now(), published_by uuid references staff(id))`, plus an index on `body_hash` (**not unique**: an edit back to an older state publishes a new version with an old hash);
  - `menu_publish_lock(id boolean primary key default true check (id))`, with its one row inserted.
- Adds `menu_categories.kind text not null default 'drink' check (kind in ('drink','food'))`, `menu_items.availability_changed_at timestamptz`.
- Produces role `kennko_api` (`nologin`, password set at deploy). It gets usage on schema `public`; select on all menu tables, `discount_presets`, `menu_snapshots`, `staff`; insert on `menu_snapshots`; select and update on `menu_publish_lock`. It also gets one RLS policy per table `to kennko_api using (true)` for exactly those privileges.

- [ ] **Step 1: Write the failing tests** in `menu-schema.test.ts`. Each one seeds today's shape (one category, Americano with M 8000 / L 9000 / XL 10000 / HOT 9500, the three modifier groups with today's modifiers), applies 0012 through the harness, and asserts:
  - `backfills a variant per old price`: Americano has variants `M,L,XL,HOT`. `HOT` has `temperature='hot'` and label `Hot`; the others have `iced` and labels `Medium`, `Large`, `XL`. Prices are unchanged.
  - `keeps modifier ids as option ids`: every old `modifiers.id` exists in `options`. The multi-select group has `min 0 max 5`, the others `min 0 max 1`.
  - `attaches every option group to every drink item`.
  - `seeds food`: a `Food` category of `kind='food'` holds:
    - **Cookies**: `REG` at 6000, `temperature 'none'`, group `Cookie flavour` (1..1: Original, Chocolate, Red Velvet at 0);
    - **Empanada**: `REG` at 4500, description `Chicken`, no group;
    - **Fries**: `REG` at 8500, group `Fries flavour` (1..1: Original, Cheese, BBQ, Sour Cream at 0).
  - `seeds discount presets`: `Senior / PWD 20%` (percent 20) and `Promo 10%` (percent 10).
  - `repoints order_item_modifiers.modifier_id to options` (an insert with an option id that is not in the old `modifiers` succeeds).
  - `stamps availability_changed_at when is_available changes` on items, variants and options.
  - `anon reads live variants only`: an archived variant, or a variant of an archived item, is invisible to `asUser(sql, null)`.
  - `a barista may change only is_available on variants and options`: a price update is refused with SQLSTATE `42501`. Seed a barista in `staff` and `auth.users` first.
  - `kennko_api can insert a snapshot and cannot update menu_items`.
- [ ] **Step 2:** Run — expect FAIL (relation `menu_variants` does not exist).
- [ ] **Step 3:** Write the migration in that order. Extend `guard_menu_item_columns` so `availability_changed_at` is also allowed for baristas, and add the matching guard triggers on `menu_variants` and `options`. Leave `menu_item_prices`, `modifier_groups` and `modifiers` in place: the live website reads them until Task 12.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit: `feat(db): menu variants, option groups, food, snapshots`.

### Task 3: Snapshot types in `packages/core`

**Files:**
- Create: `packages/core/src/snapshot.ts`; Modify: `packages/core/src/index.ts` (re-export)
- Test: `packages/core/src/snapshot.test.ts`

**Interfaces:**
- Produces (exact):

```ts
export type Temperature = 'iced' | 'hot' | 'none'
export type SnapshotVariant = { id: string; code: string; label: string; priceCentavos: number; temperature: Temperature; isAvailable: boolean }
export type SnapshotOption = { id: string; name: string; priceCentavos: number; isAvailable: boolean }
export type SnapshotOptionGroup = { id: string; name: string; minSelect: number; maxSelect: number; options: SnapshotOption[] }
export type SnapshotItem = { id: string; name: string; description: string | null; imagePath: string | null; isBestseller: boolean; isAvailable: boolean; variants: SnapshotVariant[]; optionGroupIds: string[] }
export type SnapshotCategory = { id: string; name: string; kind: 'drink' | 'food'; items: SnapshotItem[] }
export type DiscountPreset = { id: string; label: string; kind: 'percent' | 'amount'; value: number }
export type SnapshotBody = { categories: SnapshotCategory[]; optionGroups: SnapshotOptionGroup[]; discountPresets: DiscountPreset[] }
export type MenuSnapshot = SnapshotBody & { version: number; publishedAt: string }
export function liveDrinkMenu(snapshot: MenuSnapshot, now: number): Menu
```

- `liveDrinkMenu` maps to today's `Menu` (source `'website'`) for the till and the website's drink screens until Plan 2:
  - drink categories only;
  - per item, only variants whose code is in `SIZE_ORDER`, as `prices`;
  - categories or items left with nothing are dropped;
  - every option group attached to any drink becomes a `ModifierGroup` with `isMultiSelect = maxSelect > 1`, with options mapped to modifiers.

- [ ] **Step 1: Write failing tests:**
  - `drops food categories`;
  - `keeps only M/L/XL/HOT variants in size order`;
  - `maps max_select 5 to multi-select and 1 to single`;
  - `marks an item unavailable when isAvailable is false`.
- [ ] **Step 2:** Run `npm test -w @kennko/core` — expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit: `feat(core): menu snapshot types and drink-menu adapter`.

### Task 4: API skeleton — config, database, errors, health

**Files:**
- Create: `apps/api/src/config.ts`, `src/db.ts`, `src/http.ts`, `src/app.ts`, `src/index.ts`, `src/dev.ts`
- Test: `apps/api/test/app.test.ts`

**Interfaces:**
- Produces:
  - `type Config = { databaseUrl: string; supabaseUrl: string }`;
  - `loadConfig(env: Record<string, string | undefined>): Config`: zod; `DATABASE_URL` and `SUPABASE_URL` required URLs; throws a message naming the missing variable;
  - `createSql(url: string): postgres.Sql` with `{ prepare: false, max: 1, idle_timeout: 20 }`;
  - `type AppDeps = { sql: postgres.Sql; verifyUser: (token: string) => Promise<{ userId: string }> }`;
  - `createApp(deps: AppDeps): Hono`;
  - `apiError(status: number, code: string, message: string): HTTPException`. The app's `onError` turns it into JSON `{ code, message }`; anything else becomes 500 `{ code: 'INTERNAL', message: 'Something went wrong' }`, with the real error only in the log.
- `src/index.ts` builds the deps from `process.env` and `export default createApp(...)`, so Vercel deploys it with no config.
- `src/dev.ts` serves the app with `@hono/node-server` on port 4477.

- [ ] **Step 1: Write failing tests:**
  - `GET /health answers {ok:true} when the database answers` (use `startTestDb`);
  - `an unknown route answers 404 {code:'NOT_FOUND'}`;
  - `loadConfig names the missing variable`.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit: `feat(api): app skeleton with health and errors`.

### Task 5: Building and publishing snapshots

**Files:**
- Create: `apps/api/src/menu/snapshot.ts`
- Test: `apps/api/test/publish.test.ts`

**Interfaces:**
- Consumes: Task 2 tables, Task 3 `SnapshotBody`.
- Produces:
  - `buildSnapshotBody(sql: postgres.Sql | postgres.TransactionSql): Promise<SnapshotBody>`:
    - active categories, non-archived items, variants and options, in `sort_order`;
    - `isAvailable` stored as `true` everywhere, because availability is overlaid at read;
    - `optionGroupIds` per item from `item_option_groups`;
    - only option groups attached to at least one included item;
    - active discount presets.
  - `hashBody(body: SnapshotBody): string`: sha256 hex of JSON with object keys sorted recursively.
  - `publishMenu(sql: postgres.Sql, staffId: string | null): Promise<{ version: number; created: boolean }>`. In one transaction:
    1. `select id from menu_publish_lock for update`;
    2. build the body and hash it;
    3. if the hash equals the **latest** snapshot's hash, return `{ version: latest, created: false }`;
    4. otherwise insert `coalesce(max(version), 0) + 1`.

- [ ] **Step 1: Write failing tests:**
  - `first publish creates version 1`.
  - `publishing an unchanged menu creates nothing`.
  - `a price change creates version 2 and version 1 is unchanged`.
  - `an edit back to an earlier state creates a new version`: v1, change the price to make v2, change it back. Expect v3 with the same hash as v1.
  - `archived items and inactive categories are left out, and older versions still hold them`.
  - `two publishes at the same time make one version`: `Promise.all` of two `publishMenu` calls on separate connections after one change. Expect versions `[2, 2]`, with one `created: true`.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit: `feat(api): build and publish immutable menu snapshots`.

### Task 6: Staff auth

**Files:**
- Create: `apps/api/src/auth.ts`
- Test: `apps/api/test/auth.test.ts`

**Interfaces:**
- Produces:
  - `createUserVerifier(supabaseUrl: string): (token: string) => Promise<{ userId: string }>` uses jose `createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', supabaseUrl))` and `jwtVerify` with issuer `${supabaseUrl}/auth/v1` and audience `authenticated`. It throws `apiError(401, 'UNAUTHENTICATED', ...)`.
  - `requireStaff(role?: 'owner'): MiddlewareHandler` reads `Authorization: Bearer`, verifies it through `deps.verifyUser`, and loads `staff` where `id = userId`. It refuses with 403 `FORBIDDEN` when the staff member is inactive or the role doesn't match, and sets `c.set('staff', { id, role })`. Staff are re-checked on every request.
- Tests inject a `verifyUser` built from a locally generated ES256 key pair (`generateKeyPair('ES256')`, `createLocalJWKSet`), so no network is used.

- [ ] **Step 1: Write failing tests:**
  - `no token → 401`;
  - `a token signed by another key → 401`;
  - `an expired token → 401`;
  - `a valid token for a barista on an owner route → 403`;
  - `a valid token for a deactivated owner → 403`;
  - `a valid owner token → passes with staff set`.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit: `feat(api): verify Supabase staff tokens via JWKS`.

### Task 7: Menu routes

**Files:**
- Create: `apps/api/src/menu/read.ts`, `apps/api/src/routes/menu.ts`; Modify: `src/app.ts` (mount)
- Test: `apps/api/test/menu-routes.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 5 and 6.
- Produces:
  - `readMenuVersion(sql, version: number): Promise<MenuSnapshot | null>` returns the stored body exactly as stored.
  - `readLatestMenu(sql): Promise<{ snapshot: MenuSnapshot; etag: string } | null>` returns the latest body with live `is_available` from items, variants and options overlaid. Its ETag is `"v{version}-{first 8 hex of sha256 of the sorted unavailable ids}"`.
  - **Routes:**
    - `GET /v1/menu`: 200 with the snapshot, the `ETag`, and `Cache-Control: public, max-age=30, stale-while-revalidate=300`. Answers 304 on a matching `If-None-Match`, and 404 `{code:'NO_MENU'}` when nothing is published.
    - `GET /v1/menu/:version`: 200 with the stored body and `Cache-Control: public, max-age=31536000, immutable`, or 404 `NO_SUCH_VERSION`. A non-integer version gets 400 `BAD_VERSION`.
    - `POST /v1/menu/publish`: `requireStaff('owner')`, then answers 200 `{ version, created }`.

- [ ] **Step 1: Write failing tests:**
  - `no snapshot → 404 NO_MENU`;
  - `latest menu after a publish`;
  - `marking a variant sold out shows without a publish and changes the ETag`;
  - `If-None-Match with the current ETag → 304`;
  - `a version endpoint ignores later sold-out marks`;
  - `publish without a token → 401, as owner → version`.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit: `feat(api): public menu and owner publish routes`.

### Task 8: Website reads the menu from the API

**Files:**
- Create: `apps/web/lib/menu/api.ts`; Modify: `apps/web/lib/menu/queries.ts`, `apps/web/lib/env.ts`, `apps/web/.env.local.example`, `apps/web/app/page.tsx`, `apps/web/components/site/FoodMenu.tsx`, `apps/web/app/order/page.tsx`
- Test: `apps/web/lib/menu/queries.test.ts`, `apps/web/components/site/FoodMenu.test.tsx`

**Interfaces:**
- Consumes: Task 3 types and `liveDrinkMenu`; Task 7 `GET /v1/menu`.
- Produces:
  - `fetchMenuSnapshot(): Promise<MenuSnapshot | null>` fetches `${KENNKO_API_URL}/v1/menu` with `next: { revalidate: 30 }`. A 404 `NO_MENU` returns null; any other failure throws.
  - `menuFromSnapshot(s: MenuSnapshot | null): MenuCategoryWithItems[]`, the drink categories in today's web shape (`prices` from M/L/XL/HOT variants); `[]` when null.
  - `foodFromSnapshot(s: MenuSnapshot | null): FoodItem[]`.
  - `type FoodItem = { id: string; name: string; options: string[]; priceCentavos: number; isAvailable: boolean }`. `options` holds the option names of the item's first required group; `priceCentavos` is the `REG` price.
  - `getMenu()` and `getFoodMenu()` wrap these.
  - `FoodMenu({ items }: { items: FoodItem[] })`. Its art stays keyed by item name in the component (`Cookies`, `Empanada`, `Fries`), and an item with no art gets no picture.
  - The `/order` page takes its modifier groups from `liveDrinkMenu(snapshot).modifierGroups` instead of querying `modifier_groups`.
  - New env `KENNKO_API_URL`, required server-side, validated in `lib/env.ts`.

- [ ] **Step 1: Write failing tests:**
  - `menuFromSnapshot returns [] for null`;
  - `maps drink variants to sizes in order`;
  - `foodFromSnapshot lists Cookies with its three flavours at ₱60`;
  - `FoodMenu renders the items it is given` (update the existing tests to pass `items`);
  - `FoodMenu shows nothing for an empty list without crashing`.
- [ ] **Step 2:** Run `npm test -w @kennko/web` — expect FAIL.
- [ ] **Step 3:** Implement. Delete the hard-coded `FOOD` list.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit: `feat(web): read the menu from the API snapshot`.

### Task 9: Admin writes variants and publishes; checkout and seeder use variants

**Files:**
- Create: `apps/web/lib/menu/publish.ts`
- Modify:
  - `apps/web/app/admin/menu/actions.ts`, `format.ts`, `[id]/page.tsx`, `new/page.tsx` and `page.tsx` (the Publish button);
  - `apps/web/lib/orders/create.ts`;
  - `apps/web/scripts/seed-menu.ts`.
- Test: `apps/web/app/admin/menu/format.test.ts`, `apps/web/lib/menu/publish.test.ts`, the existing `lib/orders` tests

**Interfaces:**
- Consumes: Task 7 `POST /v1/menu/publish`.
- Produces:
  - `publishMenu(): Promise<{ ok: true; version: number } | { ok: false; message: string }>` (server-only). It posts with the signed-in user's access token, taken from the server Supabase client's session, and never throws for an API or network failure.
  - `parseVariantPrices(formData, kind: 'drink' | 'food'): Record<string, number | null>`. Drinks read `price_M`, `price_L`, `price_XL` and `price_HOT`; food reads `price_REG` only.
- **Admin behaviour:**
  - `saveMenuItem` upserts `menu_variants` on `(item_id, code)` with labels `Medium`, `Large`, `XL`, `Hot` or `Regular`. Temperature is `hot` for HOT, `none` for REG, and `iced` otherwise.
  - A size left blank sets that variant `is_archived = true` instead of deleting it.
  - `saveMenuItem` and `archiveMenuItem` call `publishMenu()` after saving. On failure the action throws `Saved, but the menu could not be published: <message>. Press Publish menu to try again.`
  - `setAvailability` does not publish.
  - The admin menu page gains a **Publish menu** button calling the same helper.
- **Checkout:** `create.ts` reads `menu_variants (item_id, code, price_centavos, is_available, is_archived)` where today it reads `menu_item_prices`, and `options` where it reads `modifiers`. Error codes are unchanged, and only `M/L/XL/HOT` codes are accepted until Plan 2.
- **Seeder:** `seed-menu.ts` writes `menu_variants`, `option_groups`, `options` and `item_option_groups`.

- [ ] **Step 1: Write failing tests:**
  - `parseVariantPrices reads REG only for food`;
  - `publishMenu returns ok:false with the API message when the API answers 500`;
  - `publishMenu returns ok:false when the network fails` (stub `fetch`);
  - update the `create` tests so their fixtures use variants, and add `checkout refuses a REG variant`.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit: `feat(web): admin writes variants and publishes the menu`.

### Task 10: The till pulls the menu from the API

**Files:**
- Modify: `apps/pos/server/menu.ts`, `apps/pos/server/config.ts`, `apps/pos/server/index.ts` (`/api/menu/sync`), `apps/pos/README.md`
- Test: `apps/pos/test/menu.test.ts` (new; replaces any `mapWebsiteMenu` test)

**Interfaces:**
- Consumes: Task 3 `liveDrinkMenu`, Task 7 `GET /v1/menu`.
- Produces:
  - `fetchApiMenu(apiUrl: string, now: number): Promise<Menu>` makes `GET {apiUrl}/v1/menu` with a 15 s timeout and returns `liveDrinkMenu(snapshot, now)`. It keeps today's error messages: `Could not reach the website. Check the internet and try again.`, `The website refused the menu request (<status>).`, and `The website menu came back empty, so the current menu was kept.` A 404 `NO_MENU` maps to the last of these.
  - Config `api.url`, from `config.json` or `KENNKO_API_URL`, default `''`.
  - `fetchWebsiteMenu` and `mapWebsiteMenu` are deleted, and the till no longer needs the Supabase anon key.

- [ ] **Step 1: Write failing tests:**
  - `fetchApiMenu maps a snapshot to drinks only` (stub `fetch`);
  - `an empty menu keeps the current one with the message above`;
  - `no api url → 'The website connection is not set up on this computer.'`.
- [ ] **Step 2:** Run `npm test -w @kennko/pos` — expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit: `feat(pos): pull the menu from the API`.

### Task 11: Deploy runbook and first deploy

**Files:**
- Create: `apps/api/README.md`, the runbook below.

- [ ] **Step 1:** Write `apps/api/README.md` with these steps, then do them with Julius (dashboard steps are his):
  1. **Database:** `cd apps/api && npx supabase link --project-ref <kennko ref>`, then `npx supabase db push` to apply 0012.
  2. **API login:** in the Supabase SQL editor run `alter role kennko_api with login password '<generated, 32+ chars>';`. Build `DATABASE_URL` as the **transaction pooler** URL with user `kennko_api.<project ref>`.
  3. **Vercel:**
     - Create the project from the repo with root directory `apps/api`, on the Pro team.
     - Set the function region to the Supabase project's region (check its dashboard).
     - Set the env vars `DATABASE_URL` and `SUPABASE_URL`.
     - Deploy, then check that `curl <api>/health` answers `{"ok":true}`.
  4. **First snapshot:** sign in to admin as the owner and press **Publish menu**. Check that `curl <api>/v1/menu` lists the drinks and Food.
  5. **Apps:**
     - Set `KENNKO_API_URL` on the website's Vercel project and in `apps/web/.env.local`, then deploy the website.
     - Set `api.url` in the till's `config.json`.
     - On the till, run Menu → Update with the manager PIN.
- [ ] **Step 2:** Commit: `docs(api): deploy runbook`.

### Task 12: Migration 0013 — drop the old menu tables

Run only after Task 11 step 5 is live and checkout has been tried once.

**Files:**
- Create: `apps/api/supabase/migrations/0013_drop_legacy_menu.sql`
- Test: `apps/api/test/menu-schema.test.ts` (add)

- [ ] **Step 1: Write failing test:** `after 0013, menu_item_prices, modifiers and modifier_groups are gone and menu_variants still has every price`.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Write the migration. Drop the policies on the three tables, then the tables themselves. Keep the `drink_size` type, which `order_items.size` still uses until Plan 2.
- [ ] **Step 4:** Run — expect PASS. Then search the repo for `menu_item_prices`, `modifier_groups` and `from('modifiers')`. There should be no hits outside migrations 0001–0012.
- [ ] **Step 5:** Commit: `feat(db): drop the legacy menu tables`, then `npx supabase db push` from `apps/api`.
