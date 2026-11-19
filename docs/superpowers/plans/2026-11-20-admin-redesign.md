# Admin Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin where the owner sees the whole menu on one dense screen, edits prices, bestseller and sold out in place, never forgets to publish, and moves clearly between Overview, Orders, Menu and Staff.

**Architecture:** Menu edits become drafts in the Supabase menu tables; one Publish action (the existing API `POST /v1/menu/publish`) makes them live, and a new API `GET /v1/menu/status` tells every admin page whether drafts exist. Checkout switches from pricing against the live tables to pricing against the published snapshot, so drafts never break orders. The admin gets a sidebar shell, an Overview home, a spreadsheet-style menu table with a side drawer, and tabbed orders.

**Tech Stack:** Next.js 16 App Router (server components + server actions), React 19, `@kennko/core` snapshot types, Hono API (`apps/api`), vitest + Testing Library, PGlite for API tests.

**Spec:** `docs/superpowers/specs/2026-11-20-admin-redesign-design.md`

## Global Constraints

- Use `type`, never `interface`. Money is integer centavos; format with `formatPesos()`; parse prices with the existing `parsePriceInput` (`app/admin/menu/format.ts`).
- `'use server'` modules export only async functions; pure helpers live in plain modules (apps/web/CLAUDE.md).
- In `apps/api`, relative imports use `.js` names (Vercel build); expected errors use `apiError`.
- Admin keeps the plain core style (`brand/DESIGN.md`): tokens from `@kennko/tokens`, no stickers, no cats. Tap targets at least 44px (`--tap`). Breakpoint 920px: sidebar above, bottom tab bar below.
- Permissions unchanged and enforced server-side: baristas only toggle sold out; owners edit everything and publish.
- Sold out stays instant (no publish). Every other owner menu edit is a draft until Publish.
- Exact copy: publish bar `Unpublished changes` with button `Publish`; when up to date `Menu published · version <n>`.

## Review Focus

- **A price typed and then the page left before it saved** must not vanish silently: the cell saves on Enter and on blur, shows `Saving…`, `Saved` or the error, and warns before unload while a save is pending. Pinned in Task 6.
- **A barista posting a price change directly to the server action** is refused, not just hidden. Pinned in Task 6.
- **A draft price while customers order**: the order page and checkout both use the published menu, so no `PRICE_CHANGED` from drafts. Pinned in Task 2.
- **Search with no matches** shows `No items match "<query>"`, not an empty table. Pinned in Task 6.
- **The API down** when admin loads: the publish bar shows `Menu status unavailable` and editing still works. Pinned in Task 3.

---

## File map

```
apps/api/src/routes/menu.ts            + GET /v1/menu/status
apps/api/src/menu/status.ts            NEW menuStatus(sql)
apps/web/lib/orders/create.ts          price from the published snapshot
apps/web/lib/orders/price-from-snapshot.ts   NEW pure pricing helpers
apps/web/lib/menu/status.ts            NEW getMenuStatus()
apps/web/app/admin/layout.tsx          shell: sidebar / bottom tabs, publish bar
apps/web/components/admin/AdminNav.tsx NEW (client: active link)
apps/web/components/admin/PublishBar.tsx NEW
apps/web/app/admin/page.tsx            Overview (replaces redirect)
apps/web/app/admin/menu/page.tsx       table page
apps/web/components/admin/menu/MenuTable.tsx, MenuRow.tsx, PriceCell.tsx, StarToggle.tsx, MenuItemDrawer.tsx   NEW
apps/web/app/admin/menu/actions.ts     drafts: no auto-publish; updateVariantPrice, setBestseller, saveMenuItemDraft, setItemOptionGroups
apps/web/app/admin/menu/table.ts       NEW pure: filterMenu, rowCells
apps/web/app/admin/menu/[id]/page.tsx, new/page.tsx   redirect to the drawer
apps/web/app/admin/orders/page.tsx     tabs; apps/web/app/admin/orders/tabs.ts NEW ordersForTab
apps/web/app/admin/staff/page.tsx      table restyle
apps/web/app/admin/admin.css           rewritten for the shell and table
```

---

### Task 1: API menu status

**Files:** Create `apps/api/src/menu/status.ts`; Modify `apps/api/src/routes/menu.ts`; Test `apps/api/test/menu-status.test.ts`

**Interfaces:**
- Consumes: `buildSnapshotBody`, `hashBody` (`apps/api/src/menu/snapshot.js`), `requireStaff(deps)`.
- Produces: `menuStatus(sql): Promise<{ publishedVersion: number | null; publishedAt: string | null; hasUnpublishedChanges: boolean }>`; route `GET /v1/menu/status` (any active staff) → 200 with that JSON, `Cache-Control: no-store`.

- [ ] **Step 1: Write failing tests:** `no snapshot → {publishedVersion:null, publishedAt:null, hasUnpublishedChanges:true}`; `right after publish → false`; `after a price change → true`; `after publishing again → false`; `a sold-out toggle alone → false` (availability is not part of the hash); `no token → 401`.
- [ ] **Step 2:** Run `npm test -w @kennko/api` — expect FAIL.
- [ ] **Step 3:** Implement: compare `hashBody(await buildSnapshotBody(sql))` with the latest `menu_snapshots.body_hash`.
- [ ] **Step 4:** Run — expect PASS. Root `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(api): menu status endpoint`.

### Task 2: Checkout prices from the published menu

**Files:** Create `apps/web/lib/orders/price-from-snapshot.ts`; Modify `apps/web/lib/orders/create.ts`; Test `apps/web/lib/orders/price-from-snapshot.test.ts`, update `apps/web/lib/orders/create.test.ts`

**Interfaces:**
- Consumes: `fetchMenuSnapshot()` (`lib/menu/api.ts`), `MenuSnapshot` from `@kennko/core`.
- Produces: `priceLineFromSnapshot(snapshot: MenuSnapshot, line: SubmittedLine): { ok: true; name: string; basePriceCentavos: number; modifiers: { id: string; name: string; priceCentavos: number }[] } | { ok: false; status: number; code: 'ITEM_UNAVAILABLE' | 'SIZE_UNAVAILABLE' | 'MODIFIER_UNAVAILABLE'; message: string }`. Reuse the exact codes and messages `create.ts` returns today.
- Rules: item must exist and be available; the variant `code === line.size` must exist, be available and be one of M/L/XL/HOT; every option must exist, be available, and belong to a group in the item's `optionGroupIds`. A null snapshot or fetch failure → `503 MENU_UNAVAILABLE` "The menu can't load right now. Please try again in a minute.". Delete the table reads for `menu_items`, `menu_variants`, `options`, `item_option_groups` in `create.ts`; keep everything after pricing (totals, PRICE_CHANGED, inserts) unchanged.

- [ ] **Step 1: Write failing tests** for `priceLineFromSnapshot`: priced M + option; sold-out item → ITEM_UNAVAILABLE; REG code → SIZE_UNAVAILABLE; sold-out size → SIZE_UNAVAILABLE; option from a group not attached → MODIFIER_UNAVAILABLE; sold-out option → MODIFIER_UNAVAILABLE. In `create.test.ts`: `a draft price in the tables does not cause PRICE_CHANGED` (snapshot says 8000, claimed total 8000 → not PRICE_CHANGED); `no snapshot → 503 MENU_UNAVAILABLE`.
- [ ] **Step 2:** Run `npm test -w @kennko/web` — expect FAIL.
- [ ] **Step 3:** Implement; `create.ts` fetches the snapshot once per checkout.
- [ ] **Step 4:** Run — expect PASS; root typecheck.
- [ ] **Step 5:** Commit `feat(web): checkout prices from the published menu`.

### Task 3: Drafts and the publish bar

**Files:** Create `apps/web/lib/menu/status.ts`, `apps/web/components/admin/PublishBar.tsx`; Modify `apps/web/app/admin/menu/actions.ts`, `apps/web/components/admin/PublishMenuButton.tsx`; Test `apps/web/lib/menu/status.test.ts`, `apps/web/components/admin/PublishBar.test.tsx`

**Interfaces:**
- Produces: `getMenuStatus(): Promise<{ ok: true; publishedVersion: number | null; publishedAt: string | null; hasUnpublishedChanges: boolean } | { ok: false }>` (server-only; session token; 5 s timeout; never throws).
- `PublishBar({ status, isOwner })`: when `!ok` shows `Menu status unavailable`; when drafts exist shows `Unpublished changes` and, for owners, the `Publish` button (existing `PublishMenuButton` restyled, label `Publish`); otherwise `Menu published · version <n>`. Sticky at the bottom of the main area.
- `saveMenuItem` and `archiveMenuItem` stop calling `publishMenu`; on success they `revalidatePath('/admin', 'layout')`. Remove `publishFailedUrl` use from them (keep `publish-notice.ts` only if still used by the button; delete it and its tests otherwise).

- [ ] **Step 1: Write failing tests:** `getMenuStatus` maps 200 JSON, returns `{ok:false}` on 500, network error and missing `KENNKO_API_URL`; `PublishBar` renders the three states and hides `Publish` for a barista.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS; typecheck.
- [ ] **Step 5:** Commit `feat(web): menu edits are drafts; publish bar`.

### Task 4: Admin shell and Overview

**Files:** Modify `apps/web/app/admin/layout.tsx`, `apps/web/app/admin/page.tsx`, `apps/web/app/admin/admin.css`; Create `apps/web/components/admin/AdminNav.tsx`, `apps/web/app/admin/overview.ts`; Test `apps/web/app/admin/overview.test.ts`, `apps/web/components/admin/AdminNav.test.tsx`

**Interfaces:**
- Consumes: Task 3 `getMenuStatus`, `PublishBar`.
- `AdminNav({ ordersToCheck: number, isOwner: boolean })` (client, `usePathname`): links Overview `/admin`, Orders `/admin/orders`, Menu `/admin/menu`, Staff `/admin/staff` (owner only); Orders shows a count badge when > 0; active link has `aria-current="page"`. Sidebar ≥ 920px, bottom tab bar below.
- Layout renders: sidebar (wordmark, AdminNav, `<name> · <role>`, sign out), main, and `PublishBar` (on every page except login). Loads `ordersToCheck` = count of orders with status `awaiting_verification`.
- `overviewTiles(input: { ordersToCheck: number; soldOut: number; status: MenuStatusResult }): { key: 'orders' | 'soldout' | 'menu'; title: string; value: string; href: string }[]` → `Orders to check` (`/admin/orders?tab=check`), `Sold out now` (`/admin/menu?filter=soldout`), `Menu` (`/admin/menu`, value `Version <n>` or `Unpublished changes`).
- `/admin` renders the three tiles and the five most recent orders (code, name, status, total).

- [ ] **Step 1: Write failing tests:** `overviewTiles` values and hrefs for each state; AdminNav marks the active link and hides Staff for a barista; badge shows `2` when two orders wait.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; typecheck.
- [ ] **Step 5:** Commit `feat(web): admin shell with sidebar and overview`.

### Task 5: Menu table data and filtering

**Files:** Create `apps/web/app/admin/menu/table.ts`; Modify `getAdminMenu` in `apps/web/app/admin/menu/actions.ts`; Test `apps/web/app/admin/menu/table.test.ts`

**Interfaces:**
- `getAdminMenu()` returns per item: `id, name, description, imagePath, isBestseller, isAvailable, isArchived, categoryId, prices: { code: VariantCode; priceCentavos: number; isArchived: boolean }[], optionGroupIds: string[]`, per category `id, name, kind`; plus `optionGroups: { id, name, minSelect, maxSelect }[]` (rename the return type `AdminMenu`).
- `filterMenu(menu: AdminMenu, opts: { query: string; categoryId: string | null; showArchived: boolean; soldOutOnly: boolean }): AdminMenu` — case-insensitive name match ignoring accents ("cafe" finds "Café Latte"); empty categories removed.
- `rowCells(item, kind): { code: VariantCode; label: string; priceCentavos: number | null }[]` — drinks M, L, XL, HOT (null when absent or archived); food one `REG` cell labelled `Single price`.

- [ ] **Step 1: Write failing tests** for the accent-insensitive search, category filter, archived hidden by default, sold-out filter, empty categories dropped, `rowCells` for drink and food.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; typecheck.
- [ ] **Step 5:** Commit `feat(web): admin menu data and filters`.

### Task 6: Inline-editing menu table

**Files:** Create `apps/web/components/admin/menu/MenuTable.tsx`, `MenuRow.tsx`, `PriceCell.tsx`, `StarToggle.tsx`; Modify `apps/web/app/admin/menu/actions.ts`, `apps/web/app/admin/menu/page.tsx`, `admin.css`; Test `apps/web/components/admin/menu/PriceCell.test.tsx`, `MenuTable.test.tsx`, `apps/web/app/admin/menu/actions.test.ts`

**Interfaces:**
- Server actions (owner only via `requireOwner`, which throws for baristas): `updateVariantPrice(itemId: string, code: VariantCode, raw: string): Promise<{ ok: true; priceCentavos: number | null } | { ok: false; message: string }>` — blank archives that size, a number upserts/unarchives it (labels/temperatures from `VARIANT_META`); `setBestseller(itemId: string, value: boolean): Promise<{ ok: true } | { ok: false; message: string }>`. Both `revalidatePath('/admin', 'layout')`. Return `{ ok:false, message:'Only the owner can change prices.' }` for a barista instead of throwing.
- `PriceCell({ itemId, code, label, initialCentavos, editable })`: input; saves on Enter and on blur when changed; states `Saving…`, `Saved`, or the error text under the cell; while a save is pending, `beforeunload` warns. Read-only text when `!editable`.
- `MenuTable({ menu, isOwner })` (client): search box, category chips (`All` + categories), `Show archived` toggle; reads `?filter=soldout` initial state; sticky category headers; empty result → `No items match "<query>"`; row click or `›` opens the drawer via `?edit=<id>`; `+ Add` → `?new=1` (owner only).
- `AvailabilityToggle` is reused for sold out (instant).

- [ ] **Step 1: Write failing tests:** PriceCell saves on Enter with the typed value, shows `Saved`; shows the server's error message; blank calls save with `''`; does not save when unchanged on blur; read-only for barista. `updateVariantPrice` as barista → `{ok:false, message:'Only the owner can change prices.'}`; invalid input `'abc'` → the `parsePriceInput` message. MenuTable shows `No items match "zzz"`; chips filter rows.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; replace the old card list and table in `page.tsx`. **Step 4:** PASS; typecheck.
- [ ] **Step 5:** Commit `feat(web): inline-editing admin menu table`.

### Task 7: Item drawer

**Files:** Create `apps/web/components/admin/menu/MenuItemDrawer.tsx`; Modify `apps/web/app/admin/menu/actions.ts`, `apps/web/app/admin/menu/page.tsx`, `apps/web/app/admin/menu/[id]/page.tsx`, `apps/web/app/admin/menu/new/page.tsx`; Test `apps/web/components/admin/menu/MenuItemDrawer.test.tsx`, actions test additions

**Interfaces:**
- `saveMenuItemDraft(formData): Promise<{ ok: true; id: string } | { ok: false; message: string }>` — the existing save logic without redirect or publish (new drinks still get the drink add-on links from `drinkGroupLinksFor`).
- `setItemOptionGroups(itemId: string, groupIds: string[]): Promise<{ ok: true } | { ok: false; message: string }>` — replaces the item's `item_option_groups` rows (owner only).
- `MenuItemDrawer({ item | null, categories, optionGroups, isOwner })`: right-side panel (full screen under 920px), fields name, category, description, photo (existing `ImageUploadField`), bestseller, option group checkboxes, Archive; Save keeps the table and closes the drawer (`router.replace('/admin/menu')`); Escape and the ✕ close; focus moves into the drawer on open and back on close.
- Page reads `?edit=<id>` / `?new=1`. `/admin/menu/[id]` and `/admin/menu/new` redirect to `/admin/menu?edit=<id>` and `/admin/menu?new=1`.

- [ ] **Step 1: Write failing tests:** drawer shows the item's fields and checked groups; Save calls `saveMenuItemDraft` then `setItemOptionGroups` with the checked ids; an error message renders in the drawer; Escape closes; barista sees no drawer edit controls.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; typecheck.
- [ ] **Step 5:** Commit `feat(web): admin menu item drawer`.

### Task 8: Order tabs and staff table

**Files:** Create `apps/web/app/admin/orders/tabs.ts`; Modify `apps/web/app/admin/orders/page.tsx`, `apps/web/app/admin/staff/page.tsx`, `admin.css`; Test `apps/web/app/admin/orders/tabs.test.ts`

**Interfaces:**
- `type OrderTab = 'check' | 'progress' | 'done'`; `ordersForTab(orders: { status: OrderStatus; createdAt: string }[], tab: OrderTab, now: Date)` — check: `awaiting_verification`; progress: `confirmed`, `preparing`, `ready`, `out_for_delivery`; done: `completed`, `rejected`, `cancelled` created within the last 7 days. `tabCounts(orders, now): Record<OrderTab, number>`.
- Orders page: tabs `Needs checking (n)`, `In progress (n)`, `Done` from `?tab=`, default `check` when it has orders else `progress`; existing `OrderCard`s inside. Add `created_at` to the select.
- Staff page: same data, rendered as a table (name, email, role, active, actions) matching the menu table style.

- [ ] **Step 1: Write failing tests** for `ordersForTab` (each status lands in exactly one tab; an 8-day-old completed order is excluded) and `tabCounts`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; typecheck.
- [ ] **Step 5:** Commit `feat(web): order tabs and staff table`.

### Task 9: Installable apps (PWA) for the website, admin and wall

Julius (2026-11-20): "make sure all the web apps are PWA". The till (`apps/pos`) already is (manifest, icons, `src/pwa.ts`, service worker); this task brings the website, admin and the wall to the same standard. No new dependencies.

**Files:**
- Website: Create `apps/web/app/manifest.ts`, `apps/web/public/sw.js`, `apps/web/app/offline/page.tsx`, `apps/web/components/RegisterServiceWorker.tsx`, `apps/web/public/icons/` (copy `apps/pos/public/icons/*`); Modify `apps/web/app/layout.tsx`.
- Admin: Create `apps/web/app/admin/manifest.webmanifest/route.ts`; Modify `apps/web/app/admin/layout.tsx` (metadata `manifest: '/admin/manifest.webmanifest'`).
- Wall: Create `wall/public/manifest.webmanifest`, `wall/public/pad.webmanifest`, `wall/public/sw.js`, `wall/public/icons/` (copy the till's icons); Modify `wall/public/index.html`, `wall/public/pad.html`, `wall/public/wall.mjs`, `wall/public/pad.js`, and `wall/server.mjs` only if it needs the `.webmanifest` content type.
- Test: `apps/web/app/manifest.test.ts`, `apps/web/public/sw.test.ts` (or a pure module the worker imports), `wall/test/pwa.test.mjs`.

**Interfaces / values:**
- Website manifest: name `Kennko Coffee`, short_name `Kennko`, start_url `/`, scope `/`, display `standalone`, background_color `#fff5f0`, theme_color `#0055ff`, icons 192, 512, maskable 512.
- Admin manifest: name `Kennko Admin`, short_name `Admin`, id `/admin`, start_url `/admin`, scope `/admin`, display `standalone`, background_color `#ffffff`, theme_color `#0055ff`, same icons. The admin layout's metadata points at it so installing from any admin page installs the admin app.
- Wall manifest: name `Kennko Wall`, start_url `/`, display `fullscreen`, theme_color `#0055ff`; pad manifest: name `Kennko Pad`, start_url `/pad`, display `standalone`.
- Website service worker (`/sw.js`, registered in production only, scope `/`):
  - `/_next/static/*`, `/brand/*`, `/icons/*`, fonts: cache-first.
  - Page navigations outside `/admin` and `/order`: network-first, falling back to the cached copy, then to `/offline`.
  - **Never cached:** `/admin/**`, `/order/**`, `/orders`, `/account`, `/auth/**`, `/api/**`, any non-GET request, and any response with `Cache-Control: no-store` or a `Set-Cookie`. Signed-in pages and live prices must always come from the network.
  - On a new deploy the cache name changes (versioned by a build id string written into `sw.js`), and old caches are deleted on `activate`.
- `/offline` page: sticker style, wordmark, `You're offline` and `Kennko will be right here when you're back online.`
- Wall service worker: caches the wall's static files (html, css, mjs, scene, brand, cats, icons) cache-first so the scene loads if the LAN server restarts; never caches `/api/**` or the event streams.
- iOS: `apple-touch-icon` link and `appleWebApp: { capable: true, title: ... }` metadata on the website and admin.
- **Install helper** (Julius: "so it can be installed as an app like in the home screen in tablets and phones"): a small `InstallAppButton` client component, modelled on the till's `apps/pos/src/pwa.ts` states (`installed`, `ready`, `ios`, `none`). It shows nothing when already installed; `Install Kennko Admin` / `Add Kennko to your home screen` as a button when the browser offers the prompt (Android, Chrome, Edge); on iPhone/iPad the text `Tap Share, then "Add to Home Screen"`. Placed on the admin Overview and in the website footer.

- [ ] **Step 1: Write failing tests:** website manifest values above; admin manifest values (start_url and scope `/admin`); the worker's routing helper `cacheStrategyFor(url: URL, method: string): 'cache-first' | 'network-first' | 'network-only'` (put it in a plain module the worker can import, e.g. `public/sw-routes.js`, tested from vitest) returns `network-only` for `/admin/menu`, `/order`, `/api/orders`, `/auth/callback`, a POST, and `cache-first` for `/_next/static/x.js`, `network-first` for `/`; wall test reads both manifests and checks `index.html`/`pad.html` link them.
- [ ] **Step 2:** Run root `npm test` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run root `npm test` and `npm run typecheck` — PASS. Build the website once (`npm run build -w @kennko/web`) to prove `manifest.ts` and the route compile.
- [ ] **Step 5:** Commit `feat: installable website, admin and wall (PWA)`.

### Task 10: Deploy and visual check

- [ ] **Step 1:** Run root `npm test` and `npm run typecheck`.
- [ ] **Step 2:** Deploy the API (`apps/api` has the new route) and the website to Vercel production (projects `kennko-api` and `kennko`, team `illamapaloozas-projects`; relink with `vercel link --project <name>` and delete the pulled root `.env.local` after each link).
- [ ] **Step 3:** Check `curl https://kennko-api.vercel.app/v1/menu/status` answers 401 without a token, and the website `/admin/login` loads. Julius signs in and checks: Overview tiles, a price edit shows `Unpublished changes`, Publish clears it, sold out is instant, order tabs.
