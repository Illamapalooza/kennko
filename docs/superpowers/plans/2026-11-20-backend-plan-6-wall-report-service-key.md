# Backend Plan 6: Wall Off menu.json, Day Report, Website Off the Service Key — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner sees one day's sales, cash, items and problems from every channel in admin. Anything sync could not apply (held events, flagged sales, a stuck open shift) is visible in admin and can be resolved there without SQL. The website stops holding the Supabase service key. The wall takes its drink names from the till instead of a hand-kept `wall/menu.json`.

**Architecture:**
- One migration lets a held receipt be set aside: `sync_events.result` gains `discarded`, with who, when and why. Nothing is ever deleted. It also marks shifts closed from admin and flagged orders the owner has seen.
- A new owner-only "Needs a look" API (`/v1/attention/*`) lists held and flagged sync receipts, flagged orders and open shifts, for every device including revoked ones. It discards, retries and closes them under the same per-device advisory lock the push uses, and retries that device's held events straight away.
- `GET /v1/reports/day/:date` reads the day's rows. A pure `summariseDay` in `@kennko/core` turns them into the report, and admin renders it at `/admin/reports`.
- The website's remaining service-key reads move to the API:
  - order page, receipt and customer history: public and customer endpoints;
  - proof viewing, the customer email's order data and the staff alert list: staff and server endpoints;
  - the owner invite: `POST /v1/staff`.
- `apps/web/lib/supabase/admin.ts` is deleted. In the API the service key stays confined to `src/storage.ts` and a new `src/auth-admin.ts`.
- The till's wall feed carries the drink names, and the wall caches them.

**Tech Stack:** Hono 4, postgres.js 3, zod 4, vitest 4, PGlite harness (`apps/api/test/pg.ts`), Next.js 16 (App Router, server actions), Node 24 + `node:sqlite` (till), plain Node `.mjs` (wall).

**Spec:** `docs/superpowers/specs/2026-11-20-kennko-backend-design.md`, these sections:
- Architecture (the website keeps its service key "until the last read moves"; the wall follows the till);
- API (`GET /v1/reports/day/:date`);
- Sync ("Counter events are facts", "Held events");
- Schema › Orders (`flags`) and Shifts and cash;
- Changes to each app (`apps/web`: flagged orders, a day report; `wall`: `menu.json` retired, names from the till's feed);
- Rollout order step 6.

### Where this plan sits

Plans 1–5 are implemented. The latest migration is `0017_till_sync.sql`, so this plan adds `0018_attention_and_reports.sql`. This is roadmap row 6. It picks up the items carried forward:
- Plan 4's "an admin view for held receipts comes in Plan 6" and the README runbook "a stuck open shift" (Plan 4 Ruling P4-3, its deploy step 5 and its runbook);
- Plan 4 Ruling 7's flagged counter orders "shown in admin";
- Plan 5's "admin's view of order events and till attribution".

**Out of scope:**
- Customer accounts, stamps and points (Plan 7). Cats (Plan 8).
- Editing or re-applying a held event's payload: an owner can only discard it, or retry it unchanged.
- Order-event timelines per order. The report lists flagged orders, and Needs a look lists receipts.
- CSV export of the report.
- Rate limiting the public by-code endpoints (today's routes have none either).
- The web `scripts/` seeders, which keep reading the service key from a developer's local env (Ruling 16).

## Global Constraints

- Money is integer centavos everywhere. Format only at render with `formatPesos()`; the API never sends formatted money.
- Use `type`, never `interface`.
- Imports carry their extension, as in earlier plans:
  - `.ts` inside `packages/core`;
  - `.js` for relative imports inside `apps/api/src`;
  - `.ts`/`.tsx` in `apps/pos`.
  The wall stays dependency-free `.mjs` and imports nothing from the apps.
- The API connects as `kennko_api`. Every new column or grant is covered by a privilege test (`has_table_privilege` / `has_column_privilege`). **Every API task adds its routes to the as-`kennko_api` coverage** (`apps/api/test/sync-as-api-role.test.ts` pattern: seed as superuser, run the app under `set role kennko_api`).
- `kennko_api` never gets DELETE on `sync_events`, `shifts`, `orders` or `payments`. A resolution is an update.
- Time comes from `deps.now()` in API code (reports, attention), never SQL `now()`.
- Post-commit side effects (customer pushes freed by a retry) only through `afterCommit(deps, …)`.
- The service key appears in `apps/api/src` only in `config.ts`, `boot.ts`, `storage.ts` and `auth-admin.ts`, and in `apps/web` only under `scripts/`. A test pins both.
- One new environment variable: `KENNKO_WEB_KEY`, set on both the API and the website. No new runtime dependencies.
- Brand: electric blue `#0055FF`, white, amber accent, no dark styles.
- Run `npm test` and `npm run typecheck` from the repo root before every commit.

## Rulings made while planning (Claude's calls)

1. **Resolving a receipt is a status, never a delete.**
   - `sync_events.result` gains `'discarded'`, with `resolved_at`, `resolved_by → staff` and `resolve_note` (1–200 characters, required).
   - A check makes `discarded` imply all three are set.
   - A *flagged* receipt is never discarded (it was applied). "Seen" sets `resolved_*` and leaves `result = 'flagged'`.
   - Every existing query filters `result = 'held'`, so a discarded row stops blocking its entity and leaves the push's `held` count with no other change.
2. **Every attention action runs under the device's sync lock and then retries that device's held events once** (`withDeviceLock` and `retryHeld`, exported from `sync/push.ts`). So discarding the event that blocks a sale, or closing a stuck shift, applies the waiting events immediately. That includes an old device id that will never push again after a re-pair. Customer pushes freed this way go through `afterCommit`.
3. **A stuck open shift is closed from admin with a counted amount and a note, both required** (`0` is allowed when the cash is unknown).
   - The shift gets `closed_in_admin = true` and `closed_by_staff` = the owner; `expected_centavos` stays null.
   - If the till's own `shift.closed` for that shift arrives later, its figures replace the admin close (`closed_in_admin = false`), answered `applied` with reason `replaced_admin_close`. The till's count is the better fact.
   - Any open shift may be closed this way. Open shifts that hold a till's `another_shift_open` events are listed first, marked "Blocking sync".
4. **Discarding a held sale never hides its money.** The report lists held and set-aside sales separately ("Held sales, not in the totals" and "Set aside by the owner"), with each sale's ticket number and total as sent.
5. **Needs a look is owner-only; the day report is owner or manager** (as the spec says). `requireStaff(deps, role)` accepts `'manager'`, meaning owner or manager.
6. **Flagged orders:**
   - `orders.flags_seen_at` / `flags_seen_by` mark that the owner has looked at a flagged order.
   - An order whose only flag is `legacy` never needs a look (there are thousands of them). The report counts legacy orders instead.
   - Needs a look also lists flagged *receipts*: `already_recorded_differs`, `not_for_counter`, `online_order`, `not_paid`, `not_from_till`, `unknown_item`.
7. **The report's day:**
   - Orders count on their `business_day`.
   - Shifts count on the Manila day of `opened_at`.
   - A sale counts when `prep_status <> 'cancelled' and payment_status = 'paid'`.
   - `pending_verification` is shown as "awaiting verification", never as sales.
   - Voids (counter cancelled + refunded), online refunds and online rejections are listed apart.
   - Legacy orders are inside the totals, with their count shown.
8. **A sale applied after its shift closed** (held `error:` or `shift_unknown`, then retried) counts on its own `business_day` like any sale, and is listed under its shift as "arrived after close". A shift's over or short is `counted − expected`, using the till's expected as sent; when that is null (admin close), the report computes float + cash sales + cash in − cash out. A shift's cash sales come from all its orders, whatever their business day, so a shift that runs past midnight is still whole.
9. **The aggregation is pure, in core** (`packages/core/src/report.ts`, `summariseDay`). The API only reads rows. The web only renders.
10. **The public by-code endpoints keep today's projections exactly.**
    - `GET /v1/orders/by-code/:code` is the order page. It never returns the proof path, staff note, phone, email or verifier.
    - `/receipt` is the receipt page. It shows the GCash reference only once a payment is confirmed, as `buildReceipt` already decides.
    - The API returns raw fields (statuses, ice), and the web keeps mapping them with `orderStage` / `iceSummary` / `buildReceipt`.
11. **Customer history moves unchanged** to `GET /v1/me/orders` (customer JWT). The matching rule stays the same: the user's own orders, plus guest orders under the same address only when it is confirmed. The API asks Supabase Auth whether the email is confirmed (`authAdmin.getUser`), since the JWT does not say so reliably.
12. **The service key in the API lives in two modules only:** `storage.ts` (proofs, as today) and new `auth-admin.ts` (`getUser`, `invite`, `deleteUser` over the GoTrue admin REST API, plain `fetch`).
13. **The staff alert list comes from `GET /v1/staff/alert-emails`, guarded by a shared `KENNKO_WEB_KEY`** (`X-Kennko-Web-Key`, compared in constant time). The checkout alert has no signed-in user, and the API must not return staff emails to the public. When the key is unset on either side the alert is skipped with a log line, and checkout is unaffected. The key can read only that list.
14. **Customer emails stay in the website** (Resend). The order data they need comes from `GET /v1/payments/:id/notice` (staff), and the e-receipt from the public receipt endpoint.
15. **The owner invite moves into `POST /v1/staff`:** an `email` without a `userId`, for an owner or manager, makes the API invite the person and roll the login back when the staff row fails, except on `ALREADY_STAFF` and `EMAIL_TAKEN` (today's website rule, moved). `userId` stays accepted, so the old website keeps working until it redeploys.
16. **The web `scripts/` (create-owner, seed-menu, seed-zones) keep `SUPABASE_SERVICE_ROLE_KEY` from a developer's local `.env.local`.** They never run on Vercel. `.env.local.example` says "local scripts only".
17. **The wall's names come from the till:**
    - The wall feed gains `menu: { category, items: { name, star }[] }[]`, built from the till's selling menu (drinks; `star` = bestseller). The till also serves `GET /api/wall/menu`.
    - The wall caches the last menu it got in `wall/data/menu.json`, which git ignores.
    - Without `--pos`, the wall asks `posUrl` (or `http://localhost:4466`) for the menu at start and every 10 minutes, quietly.
    - When it has never reached a till, ambient mode uses four built-in generic names. The orders-mode pad then says "No drinks yet: start the till once with the wall running".
    - `wall/menu.json` is deleted.
18. **Admin nav:**
    - "Reports" for owner and manager;
    - "Needs a look" for the owner, with a badge from `GET /v1/attention/count` that fails soft to no badge, like the orders count.

## Review Focus

1. **Nothing a till sent can vanish.** Discard is an update with who, when and why. The report still shows set-aside sales and their money, and `kennko_api` holds no DELETE. Tests in Tasks 1, 2 and 3.
2. **One bad event never holds a whole device.** Discarding the blocking receipt, or closing the stuck shift, applies the events waiting behind it at once, also for a revoked device. Admin actions and pushes on the same device serialise on one lock. Test in Task 2.
3. **The day report adds up:**
   - sales = counter + online;
   - cash = shift cash sales + in − out against counted;
   - voids, refunds, rejections and pending are kept apart;
   - legacy is inside and counted; flagged is listed;
   - a late sale counts on its day and under its shift.
   Tests in Task 3.
4. **The website holds no service key, and no read got wider:** each moved read returns the same fields as before (pinned key lists), customer history still needs a confirmed email for guest orders, and staff emails are never public. Tests in Tasks 5, 6 and 7.
5. **The wall without `menu.json`:** names follow a menu change on the till, survive a wall restart with the till off, and never carry a price. Test in Task 8.

---

### Task 1: Migration — set-aside receipts, admin-closed shifts, seen flags

**Files:**
- Create: `apps/api/supabase/migrations/0018_attention_and_reports.sql`, `apps/api/test/attention-schema.test.ts`
- Modify: `apps/api/test/migrations.test.ts` (expects 0018 if it lists files)

**Interfaces (the SQL):**
- `sync_events`:
  - drop and re-add the result check as `result in ('applied','flagged','held','discarded')`;
  - add `resolved_at timestamptz`, `resolved_by uuid references staff(id)`, `resolve_note text check (char_length(resolve_note) between 1 and 200)`;
  - add `constraint sync_events_discarded_resolved check (result <> 'discarded' or (resolved_at is not null and resolved_by is not null and resolve_note is not null))`;
  - add index `sync_events_open on sync_events (received_at desc) where result = 'held' or (result = 'flagged' and resolved_at is null)`.
- `shifts`: add `closed_in_admin boolean not null default false`.
- `orders`:
  - add `flags_seen_at timestamptz`, `flags_seen_by uuid references staff(id)`;
  - add index `orders_business_day_idx on orders (business_day)`.
- Grants: none needed (`kennko_api` already has select/insert/update on all three tables). Re-state `revoke all on sync_events, shifts from anon, authenticated`. `orders` keeps 0014's table-level select for `anon`/`authenticated` (rows are limited by RLS), so the two new order columns are readable wherever the row already is; they hold only a time and a staff id.

- [ ] **Step 1: Write `attention-schema.test.ts`** (PGlite, migrations applied):
  - The update that sets `result = 'discarded'` without `resolved_by`, as superuser, fails with `sync_events_discarded_resolved`. With all three set, it succeeds.
  - `resolve_note = ''` fails.
  - `shifts.closed_in_admin` defaults to `false`.
  - `orders.flags_seen_at` exists and is null on old rows.
  - `has_table_privilege('kennko_api','sync_events','DELETE')`, and the same for `shifts`, `orders` and `payments`, are all `false`.
  - `has_table_privilege('kennko_api','sync_events','UPDATE')` is `true`.
  - Both new indexes exist in `pg_indexes`.
- [ ] **Step 2: Run** `npm test -w @kennko/api -- attention-schema` and confirm it FAILS.
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` and confirm they PASS (`sync-schema` still passes).
- [ ] **Step 5: Commit** `feat(api): migration 0018 — set-aside receipts, admin-closed shifts, seen flags`

---

### Task 2: "Needs a look" API — see, discard, retry, close a stuck shift

**Files:**
- Create: `apps/api/src/attention/read.ts`, `apps/api/src/attention/actions.ts`, `apps/api/src/routes/attention.ts`, `apps/api/test/attention.test.ts`
- Modify:
  - `apps/api/src/sync/push.ts`: export `withDeviceLock` and `retryHeld`; `pushEvents` uses `withDeviceLock`;
  - `apps/api/src/sync/apply.ts`: `shiftClosed` replaces an admin close (Ruling 3);
  - `apps/api/src/auth.ts`: `requireStaff(deps, role?: 'owner' | 'manager')`;
  - `apps/api/src/create-app.ts`: `/v1/attention`;
  - `apps/api/test/sync-as-api-role.test.ts`;
  - `packages/core/src/sync.ts`: views and `eventSummary`.

**Interfaces:**
- `push.ts`:
  - `withDeviceLock<T>(deps, deviceId, fn: (tx, notes: Notes) => Promise<T>): Promise<T>`: one `sql.begin`, `pg_advisory_xact_lock(hashtextextended('sync:'||id, 0))`, then `fn`, then `afterCommit` for each note.
  - `retryHeld(tx, deviceId, now, notes)` is exported unchanged.
- `@kennko/core` `sync.ts`:
  - `type EventSummary = { label: string; amountCentavos: number | null }`.
  - `eventSummary(kind: string, payload: unknown): EventSummary`. It reads the payload defensively; a garbled payload gives `{ label: kind, amountCentavos: null }`. Examples:
    - `order.created` → `Sale C12, 2 lines`, with the total;
    - `shift.opened` → `Shift opened`, with the float;
    - `cash.moved` → `Cash out: Ice`, with the amount;
    - `order.prep_status` → `Step to ready`;
    - `import.order` → `Old sale C4 (before sync)`, with the total.
  - `type AttentionEvent = { deviceId; deviceName; deviceRevoked: boolean; id; seq: number; kind; result: 'held' | 'flagged' | 'discarded'; reason: string | null; summary: EventSummary; staffName: string | null; occurredAt; receivedAt; resolvedAt: string | null; resolvedByName: string | null; resolveNote: string | null; action: 'discard' | 'seen' | null }`.
  - `type FlaggedOrder = { id; ticket: string; channel; businessDay; flags: string[]; totalCentavos; deviceName: string | null; seenAt: string | null }`.
  - `type OpenShift = { id; deviceId; deviceName; deviceRevoked; openedAt; openedByName: string | null; openingFloatCentavos; blocking: number }`. `blocking` counts that device's held `another_shift_open` events.
  - `type AttentionView = { events: AttentionEvent[]; orders: FlaggedOrder[]; shifts: OpenShift[] }`.
- `read.ts`:
  - `readAttention(sql, show: 'open' | 'resolved'): Promise<AttentionView>`.
    - `open` lists receipts that are held, or flagged with `resolved_at is null`, newest first, at most 200, across **all** devices (revoked included). It also lists orders with a flag other than `legacy` and `flags_seen_at is null`, and all open shifts, with blocking ones first.
    - `resolved` lists the last 100 discarded or seen receipts, and the last 100 seen orders. Its `shifts` is `[]`.
  - `countAttention(sql): Promise<number>` = open receipts + unseen flagged orders + open shifts with `blocking > 0`.
- `actions.ts` (each returns `{ ok: true } | { ok: false; status: 404 | 409; code; message }`):
  - `resolveEvent(deps, { deviceId, eventId, action, note, staffId })` runs in `withDeviceLock`.
    - `discard` applies only to `result = 'held'` → set `discarded` and the `resolved_*` columns. Otherwise 409 `NOT_HELD`, or `NOT_OPEN` when the row is already resolved.
    - `seen` applies only to `flagged` with `resolved_at is null` → set the `resolved_*` columns. Otherwise 409 `NOT_FLAGGED` / `NOT_OPEN`.
    - Then `retryHeld(tx, deviceId, now, notes)`.
  - `retryDevice(deps, deviceId) → { held: number }` runs `retryHeld` in `withDeviceLock`. A device that does not exist → 404.
  - `closeShift(deps, { shiftId, countedCentavos, note, staffId })` reads the shift's device, then in `withDeviceLock(device)`:
    - `update shifts set closed_at = now, closed_by_staff, counted_centavos, note, closed_in_admin = true, updated_at = now where id and closed_at is null`;
    - 404 `NOT_FOUND` / 409 `ALREADY_CLOSED`;
    - then `retryHeld`.
  - `markOrderSeen(deps, { orderId, staffId })`: an order with no flags other than `legacy` → 409 `NOT_FLAGGED`; already seen → 409 `NOT_OPEN`.
- `apply.ts` `shiftClosed`: when the open-shift update finds nothing and the row has `closed_in_admin`, update it with the till's figures (`closed_at = occurredAt`, staff, counted, expected, note, `closed_in_admin = false`) → `applied('replaced_admin_close')`. Otherwise as today.
- Routes (all `requireStaff(deps, 'owner')`; zod bodies; errors `{ code, message }`):
  - `GET /v1/attention?show=open|resolved` → `AttentionView`;
  - `GET /v1/attention/count` → `{ count }`;
  - `POST /v1/attention/events/:deviceId/:eventId` with `{ action: 'discard' | 'seen', note: string 1..200 }`;
  - `POST /v1/attention/devices/:deviceId/retry`;
  - `POST /v1/attention/shifts/:id/close` with `{ countedCentavos: int 0..100_000_000, note: 1..200 }`;
  - `POST /v1/attention/orders/:id/seen`.

  A non-uuid id → 404.

- [ ] **Step 1: Write `attention.test.ts`** (`syncApp` from `sync-helpers.ts` plus an owner JWT; pushes go through `/v1/sync/push`):
  - **Seen:**
    - A push with an invalid sale (`totalCentavos: -1`) on device D → `GET` lists it with `result 'held'`, a reason starting `invalid:`, `summary.label` `Sale C…`, `deviceName` `Front till`, `action 'discard'`.
    - A legacy receipt from `/v1/sync/import` (a cash move whose shift is missing) is listed as `import.cash_move`.
    - A receipt flagged `already_recorded_differs` is listed with `action 'seen'`.
  - **Old device:**
    1. D's sale waits `shift_unknown`;
    2. D is revoked; D2 is paired and pushes that `shift.opened`;
    3. `GET` still lists D's row with `deviceRevoked: true`;
    4. `POST …/devices/D/retry` → the sale is `applied`, and `held` is 0.
  - **Discard frees the line (Review Focus 1 and 2):**
    1. an invalid `order.prep_status` for order X, then a valid step for X → held `waits_for_earlier`;
    2. discard the first with note `Typo on the till` → `result 'discarded'`, `resolved_by` = owner, the note stored;
    3. the second is now `applied`, with no further push needed;
    4. the `sync_events` count is unchanged (nothing deleted).
  - **Rules:** discard on a flagged row → 409 `NOT_HELD`; seen on a held row → 409 `NOT_FLAGGED`; a second discard → 409 `NOT_OPEN`; an empty note → 400.
  - **Stuck shift (Review Focus 2):**
    1. shift S1 open on D;
    2. a push of `shift.opened` S2 → held `another_shift_open`, and a sale on S2 → held;
    3. `GET` lists S1 with `blocking: 1`, first;
    4. `POST …/shifts/S1/close` `{ countedCentavos: 0, note: 'pos.db replaced' }` → S1 has `closed_in_admin` true and `closed_by_staff` = owner;
    5. S2 is open and the sale is applied, without another push;
    6. a second close → 409 `ALREADY_CLOSED`;
    7. the till's own `shift.closed` for S1 (counted 150000) → `applied` with reason `replaced_admin_close`; S1 has `counted 150000` and `closed_in_admin false`.
  - **Flagged orders:**
    - a sale flagged `reprice_mismatch` is listed with ticket `C…`;
    - a legacy-only order is not listed;
    - `seen` moves it to `show=resolved`.
  - `count` reflects each step above.
  - **Roles:** a manager and a barista get 403 on every route; no token → 401.
  - **Lock:** `withDeviceLock` is entered for every action (spy, or assert that a retry's freed online prep move sends exactly one customer push through `afterCommit`).
- [ ] **Step 2: Extend `sync-as-api-role.test.ts`:** as `kennko_api`, run `GET /v1/attention`, a discard, a retry, a shift close and an order seen → all 200, with no permission errors.
- [ ] **Step 3: Run** `npm test -w @kennko/api -- attention` and confirm it FAILS.
- [ ] **Step 4: Implement.** `requireStaff`: `'owner'` stays owner-only; `'manager'` admits owner or manager.
- [ ] **Step 5: Run** root `npm test` (`sync-push`, `sync-orders` and `sync-online-prep` unchanged) + `npm run typecheck` and confirm they PASS.
- [ ] **Step 6: Commit** `feat(api): needs-a-look — held and flagged receipts, flagged orders, stuck shifts, resolved from admin`

---

### Task 3: Day report — `summariseDay` in core, `GET /v1/reports/day/:date`

**Files:**
- Create: `packages/core/src/report.ts`, `packages/core/src/report.test.ts`, `apps/api/src/reports/day.ts`, `apps/api/src/routes/reports.ts`, `apps/api/test/reports.test.ts`
- Modify: `packages/core/src/index.ts`, `apps/api/src/create-app.ts`, `apps/api/test/sync-as-api-role.test.ts`

**Interfaces:**
- `@kennko/core` `report.ts`:
  - `type DayOrderRow = { id; channel: 'counter' | 'online'; fulfilment; ticketSeries: 'C' | 'W'; ticketNumber; deviceName: string | null; shiftId: string | null; prepStatus; paymentStatus; subtotalCentavos; discountCentavos; deliveryFeeCentavos; totalCentavos; flags: string[]; payments: { method: 'cash' | 'gcash'; amountCentavos: number; status: string }[] }`
  - `type DayLineRow = { orderId; itemName; variantLabel; quantity; lineTotalCentavos }`
  - `type DayShiftRow = { id; deviceName; openedAt; closedAt: string | null; openedByName; closedByName; openingFloatCentavos; countedCentavos: number | null; expectedCentavos: number | null; closedInAdmin: boolean; cashInCentavos; cashOutCentavos }`
  - `type ShiftSaleRow = { shiftId; orderId; cashCentavos; receivedAt }`: the counted orders of those shifts, whatever their business day.
  - `type HeldSaleRow = { deviceName; eventId; result: 'held' | 'discarded'; reason: string | null; ticketNumber: number | null; totalCentavos: number | null; note: string | null }`
  - `type DayRows = { date; orders: DayOrderRow[]; lines: DayLineRow[]; shifts: DayShiftRow[]; shiftSales: ShiftSaleRow[]; heldSales: HeldSaleRow[] }`
  - `type DayReport`:
    - `date`;
    - `sales: { orders, totalCentavos, discountCentavos, deliveryFeeCentavos, counter: { orders, totalCentavos, byTill: { deviceName, orders, totalCentavos, firstTicket, lastTicket }[] }, online: { orders, totalCentavos, pickup, delivery } }`;
    - `payments: { cashCentavos, gcashCentavos }`;
    - `cancelled: { counterVoids, onlineRefunded, onlineRejected }`, each `{ orders, totalCentavos }`;
    - `awaitingVerification: { orders, totalCentavos }`;
    - `items: { name, variant, quantity, totalCentavos }[]`, by quantity descending, then name;
    - `shifts: { id, deviceName, openedAt, closedAt, openedByName, closedByName, floatCentavos, cashSalesCentavos, cashInCentavos, cashOutCentavos, expectedCentavos, countedCentavos, overShortCentavos, closedInAdmin, lateSales }[]`;
    - `flagged: { id, ticket, channel, flags, totalCentavos, deviceName }[]`;
    - `legacy: { orders, totalCentavos }`;
    - `held: { held: { count, totalCentavos }, setAside: { count, totalCentavos }, rows: HeldSaleRow[] }`.
  - `summariseDay(rows: DayRows): DayReport` applies Rulings 4, 7 and 8:
    - counted = not cancelled and `paid`;
    - cash and GCash = payments of counted orders with status `recorded` or `verified`;
    - `expectedCentavos` is the till's, or float + cash sales + in − out when null;
    - `overShortCentavos` is `counted − expected`, or null while open;
    - `lateSales` = shift sales with `receivedAt > closedAt`;
    - `flagged` = orders with any flag other than `legacy`;
    - `ticket` via `ticketLabel`.
- `apps/api/src/reports/day.ts`: `readDayRows(sql, date: string): Promise<DayRows>`, a handful of selects:
  - orders by `business_day`, with payments and device name;
  - their lines;
  - shifts whose `(opened_at at time zone 'Asia/Manila')::date = date`, with staff names and cash move sums;
  - counted cash sales for those shift ids;
  - `sync_events` with kind `order.created` and result held or discarded whose `payload->>'businessDay' = date`. Ticket and total are read from the payload when they are integers, else null.
- Route: `GET /v1/reports/day/:date` with `requireStaff(deps, 'manager')`. `date` must be a real `YYYY-MM-DD`, else 400 `INVALID`. Returns `summariseDay(await readDayRows(...))`.

- [ ] **Step 1: Write `report.test.ts`** (literal rows, no database):
  - two cash counter sales (₱150, ₱245) on till A, one GCash online pickup (₱300 + ₱0 fee) and one delivery (₱200 + ₱50 fee) → sales 4 orders, ₱945; counter ₱395 (byTill A, tickets C1–C2); online ₱550, pickup 1, delivery 1; delivery fees ₱50; cash ₱395, GCash ₱550.
  - A void (counter cancelled and refunded ₱120), an online refunded order (₱180), an online rejected order (₱90) and a pending one (₱75) are all outside the sales. Each is in its own bucket.
  - Lines: Latte M ×3 across two orders → one row, quantity 3. A cancelled order's lines are not counted.
  - Shift: float ₱1,000, cash sales ₱395, in ₱200, out ₱100, till expected ₱1,495, counted ₱1,480 → over/short −₱15. A second shift closed in admin with expected null → expected computed and `closedInAdmin` true.
  - **Late sale (Ruling 8):** a shift sale received after `closedAt` → `lateSales: 1`, and it is still in `sales`.
  - **Legacy:** 2 orders, one flagged `legacy` only and one with `legacy` and `ticket_duplicate` → `legacy.orders 2`; `flagged` holds only the second.
  - **Held (Ruling 4):** one held (₱130) and one discarded (₱60) → `held.held {1, 13000}`, `setAside {1, 6000}`, neither inside `sales`.
  - An empty day gives zeros everywhere and empty lists.
- [ ] **Step 2: Write `reports.test.ts`** (PGlite, `syncApp`; the counter side through real pushes and an import, the online side with plain inserts as `sync-online-pull.test.ts` does):
  - The day's numbers match an independent sum, for these cases:
    - a sale held `shift_unknown` that applies after its shift's close (the close pushed first, the shift opened through a second device) counts on its day, with `lateSales: 1`;
    - a held invalid sale and a discarded one, carrying the payload's ticket and total;
    - an online order on the next business day is not counted;
    - a shift opened 23:30 Manila with a sale at 00:10 the next day counts on the shift's day under the shift, and on the next day under sales.
  - **Roles:** a manager gets 200; a barista with a login gets 403; no token gets 401.
  - **Dates:** `2026-02-30` → 400; `2026-11-21x` → 400.
- [ ] **Step 3: Extend `sync-as-api-role.test.ts`:** `GET /v1/reports/day/2026-11-21` as `kennko_api` → 200 with the seeded totals.
- [ ] **Step 4: Run** `npm test -w @kennko/core -- report` and `npm test -w @kennko/api -- reports` and confirm they FAIL.
- [ ] **Step 5: Implement.**
- [ ] **Step 6: Run** root `npm test` + `npm run typecheck` and confirm they PASS.
- [ ] **Step 7: Commit** `feat(api): day report across channels — sales, cash, items, refunds, flagged and held sales`

---

### Task 4: Admin — Reports and Needs a look screens

**Files:**
- Create:
  - `apps/web/app/admin/reports/page.tsx`, `apps/web/app/admin/reports/dates.ts`, `apps/web/app/admin/reports/dates.test.ts`;
  - `apps/web/app/admin/attention/page.tsx`, `apps/web/app/admin/attention/actions.ts`, `apps/web/app/admin/attention/actions.test.ts`, `apps/web/app/admin/attention/text.ts`, `apps/web/app/admin/attention/text.test.ts`;
  - `apps/web/components/admin/DayReport.tsx`, `apps/web/components/admin/AttentionRow.tsx`, `apps/web/components/admin/CloseShiftForm.tsx`.
- Modify: `apps/web/lib/auth/session.ts` (`requireManager()`: owner or manager), `apps/web/components/admin/AdminNav.tsx` (`role` prop, new links, attention badge), `apps/web/app/admin/layout.tsx` (passes `role` and `attentionCount`), `apps/web/app/admin/admin.css`, `apps/web/CLAUDE.md` (capability table rows).

**Interfaces:**
- `dates.ts`:
  - `manilaToday(now: number): string`;
  - `dayNav(date: string, today: string): { prev: string; next: string | null; label: string }`. `next` is null when `date` is today. `label` reads like `Sat 21 Nov 2026`.
  - `parseDay(q: string | undefined, today): string` falls back to today on bad input.
- `text.ts`:
  - `reasonText(result, reason): string` maps reasons to plain words:
    - `another_shift_open` → "Waiting: this till still has an open shift on Kennko";
    - `shift_unknown` → "Waiting for its shift to arrive";
    - `order_unknown` → "Waiting for its sale to arrive";
    - `waits_for_earlier` → "Waiting behind another problem on the same sale or shift";
    - `invalid: legacy: …` → "Old record that could not be stored: …";
    - `invalid: …` → "Can't be stored as sent: …";
    - `error: …` → "Failed, will try again: …";
    - flagged reasons: `already_recorded_differs` → "Sent again with different totals", `not_for_counter`, `online_order`, `not_paid`, `not_from_till`, `unknown_item`, one plain line each;
    - an unknown reason → the reason as is.
  - `flagText(flag)` does the same for `reprice_mismatch`, `unknown_version`, `ticket_duplicate`, `clock_skew`.
- `actions.ts` (`'use server'`, `requireOwner()`, `staffFetch`, `revalidatePath('/admin/attention')`, `{ ok } | { ok: false; message }` as in `devices/actions.ts`): `discardEvent(deviceId, eventId, note)`, `markEventSeen(deviceId, eventId, note)`, `retryTill(deviceId)`, `closeShift(shiftId, countedPesos: string, note)`, `markOrderSeen(orderId)`.
  - `countedPesos` is parsed to centavos (`'1,480.50'` → 148050). A bad number → "Enter the counted cash in pesos."
  - The 409 codes map to messages, for example `ALREADY_CLOSED` → "That shift is already closed. Refresh."
- Pages:
  - `/admin/reports?date=` (`requireManager`) loads `GET /v1/reports/day/:date` and renders `DayReport`, with prev/today/next links. Sections, in order:
    1. Sales (total, Counter by till with the C range, Online pickup/delivery);
    2. Payments (Cash, GCash);
    3. Cash by shift (float, cash sales, in, out, expected, counted, over/short in amber when not zero, "Closed in admin", "N arrived after close");
    4. Items;
    5. Cancelled and refunded;
    6. Awaiting verification;
    7. Flagged orders (`flagText`);
    8. Held sales, not in the totals; Set aside by the owner (with their notes);
    9. a line "Includes N orders imported from the till's history".

    Every amount goes through `formatPesos`. A failed load shows `admin-error` with "Couldn't load the report. Refresh to try again."
  - `/admin/attention?show=` (`requireOwner`) has three blocks:
    - Open shifts: "Blocking sync" pill when `blocking > 0`; `CloseShiftForm` with counted cash and a reason, and a confirm step;
    - Till records (`AttentionRow`): kind label, `summary.label` and amount, `reasonText`, till name with "(disconnected)" when revoked, staff and time; Discard or Mark seen asks for a note; one "Try again now" per till that has held rows;
    - Flagged orders: Mark seen.

    A tab "Resolved" shows who resolved each row, when, and the note. Empty → "Nothing needs a look."
- Nav:
  - links: Overview, Orders, **Reports** (owner and manager), Menu, Staff, Tills, **Needs a look** (owner, amber badge when `attentionCount > 0`);
  - the layout fetches `/v1/attention/count` only for the owner, with `.catch(() => 0)`.

- [ ] **Step 1: Write the tests:**
  - `dates.test.ts`: across Manila midnight; `next` is null on today; `parseDay('2026-13-01')` → today.
  - `text.test.ts`: every listed reason and flag, the prefix forms, and an unknown reason passed through.
  - `actions.test.ts`, with `staffFetch` mocked as in `devices/actions.test.ts`:
    - discard posts `{ action: 'discard', note }` to `/v1/attention/events/D/E`;
    - an empty note is refused before any call;
    - `closeShift('s1', '1,480.50', 'x')` posts `countedCentavos: 148050`;
    - `closeShift` with `'abc'` makes no call;
    - a 409 `ALREADY_CLOSED` gets its message;
    - a 403 gets the owner-only message;
    - `revalidatePath('/admin/attention')` is called on success.
- [ ] **Step 2: Run** `npm test -w @kennko/web -- attention reports` and confirm it FAILS.
- [ ] **Step 3: Implement.** Use the existing admin card and table classes; amber `#FFB830` accent only for over/short and pills; no dark styles.
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` + `KENNKO_API_URL= npm run build -w @kennko/web` and confirm they PASS. Manual check against a local API (`npm run dev -w @kennko/api` with PGlite seed, or deploy gate): both pages at 375, 768, 1024 and 1440 px. Tables scroll inside their card at 375 px.
- [ ] **Step 5: Commit** `feat(web): admin day report and needs-a-look screens`

---

### Task 5: API — order page, receipt and customer history reads

**Files:**
- Create: `apps/api/src/auth-admin.ts`, `apps/api/src/orders/read.ts`, `apps/api/src/routes/me.ts`, `apps/api/test/orders-read.test.ts`, `apps/api/test/auth-admin.test.ts`
- Modify:
  - `apps/api/src/create-app.ts`: `AppDeps.authAdmin: AuthAdmin`; mounts `/v1/me`;
  - `apps/api/src/boot.ts`: `createAuthAdmin(config.supabaseUrl, config.supabaseServiceRoleKey)`;
  - `apps/api/src/auth.ts`: `requireUser(deps)`, which answers 401 on a missing or invalid token and sets `userId`;
  - `apps/api/src/routes/orders.ts`: `GET /by-code/:code`, `GET /by-code/:code/receipt`;
  - `apps/api/test/fakes.ts`: `fakeAuthAdmin()`;
  - every `createApp` call in the tests (add `authAdmin`);
  - `apps/api/test/sync-as-api-role.test.ts`;
  - `packages/core/src/views.ts` (new), plus its export in `index.ts`.

**Interfaces:**
- `auth-admin.ts`, the only module besides `storage.ts` that uses the key (Ruling 12):
  - `type AuthAdmin = { getUser(id: string): Promise<{ email: string | null; emailConfirmed: boolean } | null>; invite(email: string): Promise<{ userId: string }>; deleteUser(id: string): Promise<void> }`.
  - `createAuthAdmin(supabaseUrl, serviceKey)` uses `fetch`:
    - `GET /auth/v1/admin/users/:id` → null on 404;
    - `POST /auth/v1/invite` with `{ email }`;
    - `DELETE /auth/v1/admin/users/:id`;
    - non-2xx → `Error('Auth <what> failed (<status>)')`.
- `@kennko/core` `views.ts` (raw fields; the web maps them):
  - `type PublicOrderView = { orderCode; ticket: string; prepStatus; paymentStatus; cancelled: boolean; fulfilment: 'pickup' | 'delivery'; fulfilAt: string; totalCentavos; deliveryAddress: string | null; lines: { name; variantLabel; quantity; iceLevel; iceServe }[] }`.
  - `type ReceiptView = { order: { orderCode; ticket; customerName; fulfilment; deliveryAddress; deliveryBarangay; prepStatus; paymentStatus; cancelledAt; subtotalCentavos; discountCentavos; deliveryFeeCentavos; totalCentavos; payment: { reference: string | null; verifiedAt: string | null } | null; lines: { itemName; variantLabel; quantity; unitPriceCentavos; lineTotalCentavos; options: { name; priceCentavos }[] }[] }; shop: { displayName; registeredName; tin; address; phone; facebookUrl; receiptFooter } | null }`. `payment` is the live payment by `load.ts`'s rule (newest verified, else newest non-rejected, else newest). `shop` is null when the row is missing.
  - `type HistoryOrderView = { id; orderCode; ticket; prepStatus; paymentStatus; cancelled; fulfilment; fulfilAt; createdAt; deliveryAddress; subtotalCentavos; deliveryFeeCentavos; totalCentavos; claimedByEmail: boolean; lines: { name; variantCode; variantLabel; quantity; iceLevel; iceServe; note; options: string[] }[] }`.
- `orders/read.ts`:
  - `readPublicOrder(sql, code)`, `readReceipt(sql, code)`: the code is upper-cased; only `channel = 'online'`; lines and options ordered by `created_at, id` / `id`.
  - `readHistory(sql, user: { id; email: string | null; emailConfirmed })`: `customer_user_id = id`, or (`emailConfirmed` and `lower(customer_email) = lower(email)`), newest first, limit 50.
- Routes:
  - `GET /v1/orders/by-code/:code` (public, `cache-control: no-store`) → view or 404 `NOT_FOUND`;
  - `GET /v1/orders/by-code/:code/receipt` → `ReceiptView` or 404;
  - `GET /v1/me/orders` (`requireUser`) → `{ orders: HistoryOrderView[] }`. It calls `deps.authAdmin.getUser(userId)`: null → 401 `UNAUTHENTICATED`; a throw → 503 `AUTH_UNAVAILABLE`.

- [ ] **Step 1: Write `orders-read.test.ts`** (seeded online orders, as `orders-actions.test.ts` `seedOnline` does):
  - **Order page (Review Focus 4):**
    - `Object.keys(body).sort()` equals the `PublicOrderView` key list;
    - line keys equal `['iceLevel','iceServe','name','quantity','variantLabel']`;
    - `JSON.stringify(body)` contains none of the seeded email, phone, proof path, staff note or GCash reference;
    - a lower-case code works;
    - an unknown code → 404;
    - a counter order's id is never reachable (it has no code).
  - **Receipt:**
    - the key lists are pinned;
    - `payment.reference` is the verified payment's when one was rejected and one verified;
    - lines come in insert order;
    - `shop` carries the `shop_settings` row;
    - no email, phone or proof path.
  - **History** (with `fakeAuthAdmin` returning `{ email: 'ana@x.test', emailConfirmed }`):
    - the user's own order and a guest order under `ANA@x.test` → both returned when confirmed, with the guest one `claimedByEmail: true`; only the own order when unconfirmed;
    - another person's order is never returned;
    - 51 orders → 50, newest first;
    - no token → 401; `getUser` null → 401; `getUser` throws → 503.
- [ ] **Step 2: Write `auth-admin.test.ts`** (stub `fetch`): the URLs, methods and both auth headers; null on 404; a throw on 500.
- [ ] **Step 3: Extend `sync-as-api-role.test.ts`:** all three routes as `kennko_api` → 200.
- [ ] **Step 4: Run** `npm test -w @kennko/api -- orders-read auth-admin` and confirm it FAILS.
- [ ] **Step 5: Implement.**
- [ ] **Step 6: Run** root `npm test` + `npm run typecheck` + `npm run build -w @kennko/api` and confirm they PASS.
- [ ] **Step 7: Commit** `feat(api): order page, receipt and customer history reads, with an auth-admin module`

---

### Task 6: API — proofs, customer-email data, staff alert list, owner invites

**Files:**
- Create: `apps/api/test/staff-side-reads.test.ts`, `apps/api/test/service-key-confined.test.ts`
- Modify:
  - `apps/api/src/routes/payments.ts`: `GET /:id/proof`, `GET /:id/notice`;
  - `apps/api/src/routes/staff.ts`: the invite in `POST /`, and `GET /alert-emails`;
  - `apps/api/src/auth.ts`: `requireWebKey(deps)`;
  - `apps/api/src/config.ts`: `KENNKO_WEB_KEY` optional, min 32 characters;
  - `apps/api/src/create-app.ts`: `AppDeps.webKey: string | null`;
  - `apps/api/src/boot.ts`;
  - `apps/api/test/staff.test.ts`, `apps/api/test/boot.test.ts`, `apps/api/test/sync-as-api-role.test.ts`;
  - `packages/core/src/views.ts`: `PaymentNotice`.

**Interfaces:**
- `type PaymentNotice = { to: string; orderCode; ticket; customerName; fulfilment: 'pickup' | 'delivery'; fulfilAt: string | null; totalCentavos; deliveryAddress: string | null; items: { name; variantLabel; quantity }[] }`
- `GET /v1/payments/:id/proof` (`requireStaff`) → `{ url }`, from `deps.proofs.signedUrl(proof_path, 300)`. No such payment, or no proof → 404.
- `GET /v1/payments/:id/notice` (`requireStaff`) → `PaymentNotice`. No email → 404 `NO_EMAIL`.
- `requireWebKey(deps)`:
  - `deps.webKey` null → 503 `NOT_CONFIGURED`;
  - the header `X-Kennko-Web-Key` missing or different (`timingSafeEqual` over SHA-256 digests) → 401 `UNAUTHENTICATED`.
- `GET /v1/staff/alert-emails` (`requireWebKey`) → `{ emails: string[] }`: active staff with an email.
- `POST /v1/staff` (Ruling 15):
  - `role !== 'barista'`, with `email` and no `userId` → `deps.authAdmin.invite(email)`; on a throw → 502 `INVITE_FAILED` "Could not send the invite. Try again." Then insert.
  - On an insert error other than `ALREADY_STAFF` / `EMAIL_TAKEN`, `deleteUser` runs best effort (logged) and the original error is answered.
  - An owner without `email` and without `userId` → 409 `NEEDS_LOGIN`, as today.
  - A body with `userId` behaves exactly as today.

- [ ] **Step 1: Write `staff-side-reads.test.ts`:**
  - proof: a staff token → `{ url }` from `fakeProofs` with 300 s; a barista login works too (today's `proofUrl` is any staff); no token → 401; a payment without a proof → 404.
  - notice: the fields of a seeded order; no email → 404.
  - alert emails:
    - correct key → the active emails only (an inactive owner and a barista with no email are excluded);
    - wrong key → 401; no header → 401; `webKey` null → 503;
    - a staff JWT without the key → 401, so no other auth opens it.
  - invite:
    - manager with email → `invite` called once, row has the invited `user_id`;
    - `invite` throws → 502 and no row;
    - insert fails with a forced FK error → `deleteUser` called with that id;
    - `EMAIL_TAKEN` → `deleteUser` not called;
    - barista with email → no invite;
    - body with `userId` → no invite (old website path).
- [ ] **Step 2: Write `service-key-confined.test.ts`:** walks `apps/api/src`. Only `config.ts`, `boot.ts`, `storage.ts` and `auth-admin.ts` may contain `SUPABASE_SERVICE_ROLE_KEY`, `supabaseServiceRoleKey` or `serviceKey`.
- [ ] **Step 3: Extend `sync-as-api-role.test.ts`:** proof, notice, alert-emails and an invite as `kennko_api` → 200/201.
- [ ] **Step 4: Run** `npm test -w @kennko/api -- staff-side-reads service-key-confined staff boot` and confirm it FAILS.
- [ ] **Step 5: Implement.** `boot.test.ts`: the API boots without `KENNKO_WEB_KEY` (`webKey: null`), and a key under 32 characters fails with the variable named.
- [ ] **Step 6: Run** root `npm test` + `npm run typecheck` + `npm run build -w @kennko/api` and confirm they PASS. Load `server.js` with dummy env as in earlier plans.
- [ ] **Step 7: Commit** `feat(api): proof links, customer-email data, staff alert list and owner invites`

---

### Task 7: Website off the service key

**Files:**
- Create: `apps/web/lib/no-service-key.test.ts`
- Delete: `apps/web/lib/supabase/admin.ts`
- Modify:
  - `apps/web/lib/api/client.ts`: `publicFetch`, `userFetch`, `webKeyFetch`;
  - `apps/web/lib/orders/lookup.ts`, `apps/web/lib/orders/history.ts`, `apps/web/lib/receipts/load.ts`, `apps/web/lib/email/send.ts` (`activeStaffEmails`);
  - `apps/web/app/admin/orders/actions.ts` (`emailFor` → notice; `proofUrl(paymentId)`), `apps/web/components/admin/OrderCard.tsx`, `apps/web/app/admin/staff/actions.ts`;
  - the tests that mock `getAdminClient`: `lib/orders/lookup.test.ts`, `lib/receipts/load.test.ts`, `app/admin/orders/actions.test.ts`, `app/admin/staff/actions.test.ts`;
  - `apps/web/.env.local.example`, `apps/web/CLAUDE.md` (Environment and Admin sections).

**Interfaces:**
- `client.ts`:
  - `publicFetch(path, init?)`: no auth, `no-store`, 15 s timeout.
  - `userFetch(path, init?)`: the signed-in user's access token, as `staffFetch` does; it throws when nobody is signed in.
  - `webKeyFetch(path)` sends `X-Kennko-Web-Key: process.env.KENNKO_WEB_KEY`, and returns null without a fetch when the variable is unset.
- `lookupOrder(code)` → `publicFetch('/v1/orders/by-code/'+encode(code))`. 404 → null; any other failure throws (the page's error boundary, not a 404). The `PublicOrderView` maps to today's `PublicOrder` with `orderStage(prep, payment, cancelled)` and `iceSummary`. **`PublicOrder` is unchanged.**
- `getOrderHistory(customer)` → `userFetch('/v1/me/orders')`. A non-200 throws `Could not load your orders`. It maps to today's `HistoryOrder`.
- `loadReceiptOrder(code)` and `loadShopSettings()`:
  - both read `GET /v1/orders/by-code/:code/receipt`; the receipt page fetches it once through a new `loadReceipt(code): Promise<{ order: ReceiptOrder; settings: ShopSettings } | null>`;
  - `loadShopSettings()` stays for the email path and uses the same response;
  - `FALLBACK_SETTINGS` applies when `shop` is null.
- `activeStaffEmails()` → `webKeyFetch('/v1/staff/alert-emails')`. Null or a failure → `[]`, with `console.error('[email] staff alert list unavailable')`. `sendEmail` with no recipients already returns early (check, and add that if not).
- `admin/orders/actions.ts`:
  - `emailFor(paymentId)` → `staffFetch('/v1/payments/:id/notice')`, mapped to `OrderEmailData` with `formatManilaDateTime`; 404 → null.
  - `proofUrl(paymentId)` → `staffFetch('/v1/payments/:id/proof')` → `url | null`.
  - `OrderCard` passes `order.paymentId`. The proof button shows when `proofPath !== null && paymentId !== null`.
- `admin/staff/actions.ts` `addStaff` posts `{ fullName, role, email? }` to `/v1/staff` (no invite or delete here). It maps `INVITE_FAILED` → "Could not send the invite. Try again."; other codes as today.
- `no-service-key.test.ts` walks `app/`, `components/`, `lib/` and `proxy.ts`. None contains `SUPABASE_SERVICE_ROLE_KEY`, `supabase/admin` or `getAdminClient`, and `lib/supabase/admin.ts` does not exist. `scripts/` is not walked (Ruling 16).

- [ ] **Step 1: Rewrite the four mocked tests against the API** (mock `@/lib/api/client`):
  - lookup: maps a view to the same `PublicOrder` the old test expected; 404 → null; 500 → throws.
  - receipt: maps to the same `ReceiptOrder`; `shop: null` → `FALLBACK_SETTINGS`.
  - orders actions:
    - `confirmPayment` sends the confirmation to `notice.to` with the receipt;
    - notice 404 → no email, still ok;
    - `proofUrl('p1')` calls `/v1/payments/p1/proof`.
  - staff actions:
    - posts `email` without `userId`;
    - `INVITE_FAILED` gets its message;
    - nothing imports `getAdminClient`.
  - history (new test): mapping and `claimedByEmail` pass through; a 401 throws.
  - `no-service-key.test.ts` as above.
- [ ] **Step 2: Run** `npm test -w @kennko/web` and confirm it FAILS.
- [ ] **Step 3: Implement.** Delete `admin.ts`. In `.env.local.example`, comment `SUPABASE_SERVICE_ROLE_KEY` as "local scripts only (npm run seed, create-owner); never set it on Vercel" and add `KENNKO_WEB_KEY=` with a note that it must equal the API's.
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` + `KENNKO_API_URL= npm run build -w @kennko/web` and confirm they PASS. Manual check against a local API: the order page, the receipt, `/orders` signed in, admin › Orders › View proof, Confirm (email logged in dev), and Staff › Add a manager with email.
- [ ] **Step 5: Commit** `feat(web): order page, receipts, history, proofs, emails and invites through the API; service key removed`

---

### Task 8: Wall off `menu.json` — drink names from the till

**Files:**
- Create: `wall/menu-source.mjs`, `wall/test/menu-source.test.mjs`
- Delete: `wall/menu.json`
- Modify:
  - `apps/pos/server/wall-feed.ts`: `wallMenu`;
  - `apps/pos/server/index.ts`: the feed gains `menu`; `GET /api/wall/menu`;
  - `apps/pos/test/wall-feed.test.ts`;
  - `wall/server.mjs`, `wall/README.md`, `apps/pos/README.md` (the wall line).

**Interfaces:**
- Till:
  - `type WallMenu = { category: string; items: { name: string; star: boolean }[] }[]`.
  - `wallMenu(menu: Menu): WallMenu` covers the selling menu's categories, keeping every item whether sold out or not (the barista cats show names, not stock). It skips empty categories. Only `category`, `name` and `star` are picked.
  - `wallSnapshot()` adds `menu: wallMenu(menu())`. `GET /api/wall/menu` → `{ menu }`, with no PIN, like the feed.
- `wall/menu-source.mjs`:
  - `FALLBACK_DRINKS = ['Latte', 'Americano', 'Mocha', 'Caramel Macchiato']`;
  - `readMenu(x): Menu | null` validates: an array of at most 30 categories, at most 200 items in total, names are non-empty strings cut to 40, `star` boolean. Anything else → null;
  - `loadCachedMenu(file)` / `saveCachedMenu(file, menu)` write atomically (`.tmp` + rename) and never throw;
  - `namesOf(menu): Set<string>`;
  - `fetchTillMenu(baseUrl, timeoutMs = 3000): Promise<Menu | null>`.
- `server.mjs`:
  - `let menu = loadCachedMenu(DATA/menu.json) ?? []`.
  - `menuNames` stays one `Set`, updated in place (clear, then add) so `reduceOpts` keeps working.
  - `setMenu(next)` updates both and saves when the JSON changed.
  - In `--pos` mode, `onFeed` calls `setMenu(readMenu(feed.menu))` when non-null.
  - Otherwise `fetchTillMenu(posUrl || config.posUrl || 'http://localhost:4466')` runs at start and every 10 minutes (`unref`), quietly.
  - Ambient picks from `menuNames`, or `FALLBACK_DRINKS` when empty.
  - `/api/bootstrap` sends the current `menu`.
  - The startup warning becomes "No drink names yet: they come from the till."
  - The pad (`pad.js`) shows "No drinks yet: start the till once with the wall running" when `boot.menu` is empty.

- [ ] **Step 1: Write the failing tests:**
  - `wall-feed.test.ts`:
    - `wallMenu` of a menu with a sold-out bestseller keeps it with `star: true`;
    - the result's keys deep-walk to only `category`, `items`, `name` and `star` (no price, id or `isAvailable`);
    - empty categories are dropped.
  - `menu-source.test.mjs`:
    - `readMenu` accepts the till's shape and rejects a string, 31 categories, a non-string name and 201 items;
    - a 60-character name is cut to 40;
    - save then load round-trips in a temp dir;
    - loading a corrupt file → null;
    - `namesOf`;
    - `fetchTillMenu` against a tiny `http.createServer` returns the menu; a closed port → null within the timeout.
  - The existing `pos-link`, `store` and `logic` tests still pass, including the pad's "That drink is not on the menu" with `menuNames` set through `setMenu`.
- [ ] **Step 2: Run** `node --test wall/test/*.test.mjs` and `npm test -w @kennko/pos -- wall-feed` and confirm they FAIL.
- [ ] **Step 3: Implement.** Delete `wall/menu.json`. In the README, the Menu bullet becomes "Drink names come from the till (its published menu) and are remembered in `data/menu.json`; there is nothing to edit."
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` + `npm run build -w @kennko/pos` and confirm they PASS. Manual check:
  1. `npm run pos` + `npm run wall:pos`: the barista cats show names from the till;
  2. rename a drink in the till's snapshot (publish in admin): the name follows within one feed frame;
  3. stop the till and restart the wall without `--pos`: ambient uses the cached names.
- [ ] **Step 5: Commit** `feat(wall): drink names from the till's feed; menu.json retired`

---

### Task 9: Deploy checklist and runbook

**Files:** `apps/api/README.md`: a "Plan 6" section. Replace "Runbook: a stuck open shift" with the admin steps, keeping the SQL only as a last resort, and change the "An admin view … comes in Plan 6" lines to point at Needs a look. Nothing is run by the implementer: Julius deploys.

- [ ] **Step 1:** On the branch tip, run root `npm test`, `npm run typecheck`, `KENNKO_API_URL= npm run build -w @kennko/web`, `npm run build -w @kennko/api` (load `server.js` with dummy env), and `npm run build -w @kennko/pos`.
- [ ] **Step 2: Write the checklist** into the README, in this order:
  1. **Migration** `0018_attention_and_reports.sql`: dry run first; expect only 0018.
  2. **API:**
     - Generate a key (`openssl rand -hex 32`) and add it as `KENNKO_WEB_KEY` to the API's Vercel project (Production). The API keeps `SUPABASE_SERVICE_ROLE_KEY`. Deploy.
     - Smoke checks:
       - `/health` 200;
       - `GET /v1/orders/by-code/KNK-XXXXXX` → 404 JSON;
       - `GET /v1/staff/alert-emails` without the header → 401;
       - `GET /v1/reports/day/<today>` without a token → 401.
     - The old website keeps working: it still has its key.
  3. **Website:**
     - Add the same `KENNKO_WEB_KEY` to the website's project. Deploy.
     - Then delete `SUPABASE_SERVICE_ROLE_KEY` from the website project (Production, Preview and Development) and redeploy.
     - Check that a fresh deployment's build log and runtime show no "Missing … SERVICE_ROLE_KEY" error.
     - **Recommended:** rotate the Supabase secret key (it lived on the website until now). Create a new secret key in Supabase, put it in the **API** project only, redeploy the API, then revoke the old one.
  4. **Till** (shop computer): pull, `deploy\windows\setup.cmd` (build + restart). Reload the tablets.
  5. **Wall:** pull and restart `npm run wall:pos`. `wall/data/menu.json` appears after the first feed.
  6. **Live checks:**
     - Admin › Reports for today:
       - the counter total equals the till's day summary;
       - online equals the verified online orders;
       - each shift's counted matches the till's close;
       - the legacy line shows the imported count on the history days.
     - Admin › Needs a look lists the held rows the Plan 4 SQL showed (`select kind, reason, count(*) from sync_events where result = 'held' group by 1, 2;`). Discard one test row with a note; it moves to Resolved.
     - The order page, receipt and `/orders` (signed in with Google) load. Admin › Orders › View proof opens the image. Confirming a ₱ test order emails the customer with the receipt, and a new order still emails staff.
     - Staff › add a manager with an email → the invite arrives.
     - The wall shows the till's drink names. Publish a renamed drink → the wall follows.
- [ ] **Step 3: Commit** `docs(api): plan 6 deploy checklist and admin runbook`

## Self-review notes

- **Spec coverage for roadmap row 6:**
  - wall off `menu.json`, names from the till's feed ✔ (8);
  - `GET /v1/reports/day/:date` for owner or manager: sales across channels, cash, items, flagged orders ✔ (3), with an admin day report ✔ (4);
  - flagged orders in admin ✔ (2, 3, 4);
  - the remaining website reads off the service key (order lookup, customer history, admin order email data, proof viewing, receipts, staff alert list, invite) ✔ (5, 6, 7), and the key removed from the website ✔ (7, 9).
- **The carried items:**
  - held-events view with discard and seen, for every device including revoked ✔ (1, 2, 4);
  - stuck shift closed from admin, replacing the SQL runbook ✔ (2, 9);
  - `error:` sales applied after their shift's close ✔ (3, Ruling 8);
  - legacy history flagged and counted ✔ (3);
  - W and C series ✔ (3: online, and counter by till with its C range);
  - shift cash and cash moves ✔ (3);
  - refunds and cancellations ✔ (3);
  - flagged orders and flagged receipts ✔ (2, 3).
- **Must-have tests from the spec in scope:** none new (they belong to Plans 1–5). The allowlist-style key pins in Tasks 5 and 6 protect the moved reads the same way.
- **Every app keeps working when deployed alone, in order:**
  - the migration only adds columns, a check value and indexes;
  - the API is additive; the old website ignores it, and `POST /v1/staff` still takes `userId`;
  - the website needs the new API (deployed first) and then its key can go;
  - the new till's feed adds a `menu` key, which an old wall ignores;
  - a new wall with an old till runs on its cache or fallback names.
- **Known limits:**
  - The report reads up to a day of rows in one request. That is fine at one shop's volume, and there is no pagination.
  - Discarded counter sales stay out of the totals by design: the owner sees them listed, never summed into sales.
  - The by-code endpoints are as guessable as today's pages.
- **Deferred:** editing or re-sending a held payload; per-order event timelines; CSV export; rate limits on public reads.
