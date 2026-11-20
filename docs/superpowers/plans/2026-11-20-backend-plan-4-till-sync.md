# Backend Plan 4: Till Sync — Outbox, Push, Pull, One-Time pos.db Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every counter sale, void, shift and cash move leaves the shop computer and lands in Postgres exactly once, without the till ever waiting on the network; the till follows the published menu, sold-out marks, staff PINs and shop details from one pull; history already in `pos.db` is imported once.

**Architecture:** One migration adds `shifts`, `cash_moves`, the counter columns on `orders`/`payments`, and a `sync_events` receipt table. The API gains `POST /v1/sync/push` (per-device advisory lock, one savepoint per event, results `applied | flagged | held | duplicate`, held events retried by the API), `GET /v1/sync/pull` (state, not a change log) and `POST /v1/sync/import` (legacy history in chunks). The rules both sides must agree on (event shapes, counter re-pricing, the till→prep status map) live in `packages/core/src/sync.ts`. On the till, every store write adds an outbox row in the same SQLite transaction; a sync loop imports, pushes and pulls after each change, every 15 s online, and with backoff offline. The pull replaces Plan 3's 5-minute `/v1/devices/me` refresh.

**Tech Stack:** Hono 4, postgres.js 3 (`sql.begin` + `tx.savepoint`), zod 4, vitest 4, PGlite harness (`apps/api/test/pg.ts`), Node 24 + `node:sqlite` and `node:crypto` (till), React 19.

**Spec:** `docs/superpowers/specs/2026-11-20-kennko-backend-design.md` — sections Schema › Orders (counter columns, flags), Schema › Shifts and cash, Sync (till ↔ API), API (sync endpoints), Changes to each app (`apps/pos`), Rollout order step 4 (second half), Left to the builder (must-have tests).

### Where this plan sits

Plans 1–3 and "ordering nav/receipts/push" are implemented; latest migration is `0016_staff_pins_and_devices.sql`. This is roadmap row 4. It picks up Plan 3's deferred items (its Rulings 1, 8, 10, 12): `shifts`/`cash_moves`, attribution of voids, cash moves and closes, the sold-out PIN, the clock check, and moving the staff refresh into the pull. **Out of scope:** paid online orders in the pull and the till queue (Plan 5; the pull shape leaves room for an `onlineOrders` key), admin screens for flagged orders and held events (Plan 6's day report), food on the till's sell screen (the till keeps selling drinks via `liveDrinkMenu`).

## Global Constraints

- Money is integer centavos everywhere; format only at render with `formatPesos()` from `@kennko/core`.
- Use `type`, never `interface`.
- Imports inside `packages/core` carry `.ts`; relative imports inside `apps/api/src` carry `.js`; `apps/pos` imports carry `.ts`/`.tsx`.
- Text + `check` for every new kind/result column; no new Postgres enums.
- Every new table: RLS on, `revoke all … from anon, authenticated`, explicit grants and `to kennko_api` policies. Privilege tests use `has_table_privilege` / `has_column_privilege`, never a literal TRUNCATE.
- The API's database access is role `kennko_api` only; time comes from `deps.now()` (never SQL `now()` in sync code) so tests pin the clock.
- **A sale is never blocked by the network.** No till route awaits the API except pairing and the explicit "Check now".
- **Counter events are facts:** an order the till pushes is stored as sent or held for retry; it is never refused or dropped.
- Sync constants (exact, in `packages/core/src/sync.ts`): `MAX_PUSH_EVENTS = 50`, `IMPORT_CHUNK_MAX = 100`, `MAX_HELD_RETRY = 200`, `CLOCK_WARN_MS = 300_000`, `SYNC_EVERY_MS = 15_000`, `BACKOFF_MS = [15_000, 30_000, 60_000, 120_000, 300_000]`, `KICK_DEBOUNCE_MS = 300`.
- Flags (exact strings): `reprice_mismatch`, `unknown_version`, `ticket_duplicate`, `clock_skew`, `legacy`.
- API error bodies on sync routes: `{ code, message }` via `apiError`. No new environment variables, no new runtime dependencies (UUIDv5 uses `node:crypto` SHA-1).
- Run `npm test` and `npm run typecheck` from the repo root before every commit.

## Rulings made while planning (Claude's calls)

1. **`sync_events` is the receipt for every pushed event**, keyed `(device_id, id)`. Shift, cash and sold-out events have no order, and a held event cannot reference an order that does not exist yet, so `order_events` cannot be the only record. Order events still write an `order_events` row with the **same id and device**, so the spec's `unique (device_id, id)` keeps guarding them.
2. **One outer transaction per push holds `pg_advisory_xact_lock(hashtextextended('sync:' || device_id, 0))`; each event runs in its own savepoint.** That is the spec's "per-event transaction" with the lock held across the whole request, which a sequence of separate transactions cannot do through the transaction pooler.
3. **The API keeps held events and retries them itself** at the start of every push from that device (oldest `seq` first, at most `MAX_HELD_RETRY`). The till deletes an outbox row as soon as the API answers it with any of the four results.
4. **What holds:** a missing shift (for `order.created`, `cash.moved`, `shift.closed`), a missing order (`order.prep_status`, `order.cancelled`), another open shift on the device (`shift.opened`), and any event touching an entity (`order:<id>`, `shift:<id>`) that already has an earlier held event, so per-entity order survives. A payload that fails validation or would break a table check (impossible totals) is **held** with reason `invalid: …` — kept, visible, never applied altered, never dropped.
5. **Entities are matched by id, not by device**, so a till paired again mid-shift can still close its own shift.
6. **An unknown or null `menu_version` is stored as null with `unknown_version`** (the column references `menu_snapshots`). Item, variant and option ids that are not uuids present in the menu tables (the built-in menu uses slugs) are stored as null refs; names and prices are kept as sent.
7. **Counter prep changes apply in the order received** (unconditional set; no-op on a cancelled order). Admin's `PATCH /v1/orders/:id` refuses a prep change on a counter order with 409 `COUNTER_ORDER` — the till owns counter prep until Plan 5.
8. **Till outbox payloads never store a foreign UUID.** They store the entity's local id; `outboxEvents()` fills `orderId`/`shiftId`/cash-move `id` from the local rows at send time, so rows that only get their UUIDv5 after pairing still send correctly.
9. **Legacy = every row present the first time the till runs this version** (SQLite marker `kv.schema = '4'`). UUIDs: `uuidv5(KENNKO_TILL_NS, "<deviceId>:<table>:<localId>")` with `KENNKO_TILL_NS = '6f1c3a52-9a0e-4c7b-8d0f-2b7c5e4a9d13'`, assigned once a device id is known and stored permanently (re-pairing never changes them). Rows created after the upgrade get `randomUUID()` at insert. Each sync run imports before it pushes. An acknowledged import chunk deletes the outbox events of those rows written before the chunk was read (the import already carries their latest state), so nothing is replayed backwards.
10. **The import carries whatever attribution the local row has** (null for anything done before the upgrade) and skips a cash move whose shift is missing rather than failing the chunk.
11. **The pulled menu applies itself** when its version is newer: no manager PIN. When paired, "Update from website" becomes **Check now** (runs one sync). Unpaired tills keep today's PIN-gated manual pull of `GET /v1/menu`, now saving the raw snapshot.
12. **Shop details from the pull are name, address and phone only.** `shop_settings.receipt_footer` is written for e-receipts ("Ask for your official receipt…"), so the till keeps `config.json`'s footer.
13. **Till discounts come from the snapshot's `discountPresets`** when a snapshot is loaded and has any; otherwise `config.json`'s list, as today.
14. **Sold-out:** an availability change writes an outbox row only while paired (an hours-old toggle sent after pairing would undo admin). A pull replaces the till's marks with the server's, then replays the till's unsent toggles on top. In per-person mode a toggle asks for the person's own PIN (any role, for attribution); shared and off modes are unchanged.
15. **Attribution:** a sale, shift open, cash in, advance/undo and sold-out change are credited to the session's person; a void, cash out and close to the person whose manager PIN approved it. Shared-mode sessions credit nobody (`null`).
16. **The offline badge shows only when paired and the last attempt failed**: "Offline: N sales waiting to send" (N = unsent `order.created`), or "Offline: changes waiting to send" when only other events wait.
17. **`GET /v1/devices/me` stays** for tills not yet upgraded; the new till stops calling it.
18. `shifts.expected_centavos` has no `>= 0` check (float − cash out can go negative); `payments` gains `device_id` (listed in the spec).

## Review Focus

1. **A push retried while the first is still running, or sent twice:** the second answers `duplicate` for every event; no order, payment, line or event row is written twice. Test in Task 3 (and Task 4 for orders).
2. **A counter sale the API disagrees with** (priced against an old snapshot, an unknown version, a repeated C number, a till clock days off): stored exactly as sent with the right flag, answered `flagged`, never refused. Test in Task 4.
3. **Events arriving without what they depend on** (a cash move or status change for a shift or order the API never stored): held, retried on later pushes, applied once the dependency arrives, never dropped; a later event for the same order waits behind it. Test in Tasks 3 and 4.
4. **The till offline for a day, then back:** sales keep ringing; the badge counts them; the backlog drains in outbox order in batches of 50; a crash between the API answering and the till deleting rows only causes `duplicate`s. Test in Tasks 7 and 8.
5. **The import interrupted half-way, or run twice:** no duplicate rows; a void or close done to a legacy row after the upgrade is neither lost nor replayed backwards. Test in Tasks 6 and 9.
6. **Sold-out toggled on the till while offline and in admin meanwhile:** whichever the server receives last wins, and a pull never wipes a toggle the till has not sent yet. Test in Tasks 3 and 8.

---

### Task 1: Sync contract and counter re-pricing in core

**Files:**
- Create: `packages/core/src/sync.ts`, `packages/core/src/sync.test.ts`
- Modify: `packages/core/src/index.ts` (export `sync.ts`), `packages/core/src/menu.ts` (`Menu.version?: number`), `packages/core/src/snapshot.ts` (`liveDrinkMenu` sets `version: snapshot.version`), `packages/core/src/snapshot.test.ts`

**Interfaces:**
- Produces (`@kennko/core`):
  - The constants in Global Constraints.
  - `TILL_TO_PREP: Record<OrderStatus, PrepStatus>` — `queued→placed, preparing→preparing, serving→ready, done→completed, voided→cancelled`.
  - `type SyncEventKind = 'order.created' | 'order.prep_status' | 'order.cancelled' | 'shift.opened' | 'shift.closed' | 'cash.moved' | 'menu.availability'`
  - `type CounterOrderPayload = { orderId: string; shiftId: string; businessDay: string; ticketNumber: number; fulfilment: OrderType; customerName: string; menuVersion: number | null; lines: PricedLine[]; discount: Discount | null; subtotalCentavos: number; discountCentavos: number; totalCentavos: number; payment: { id: string; method: PaymentMethod; tenderedCentavos: number | null; changeCentavos: number | null; reference: string | null } }`
  - `type SyncEvent = { id: string; seq: number; occurredAt: string; staffId: string | null } & ({ kind: 'order.created'; payload: CounterOrderPayload } | { kind: 'order.prep_status'; payload: { orderId: string; to: PrepStatus } } | { kind: 'order.cancelled'; payload: { orderId: string; reason: string } } | { kind: 'shift.opened'; payload: { shiftId: string; openingFloatCentavos: number } } | { kind: 'shift.closed'; payload: { shiftId: string; countedCentavos: number; expectedCentavos: number; note: string } } | { kind: 'cash.moved'; payload: { id: string; shiftId: string; kind: 'in' | 'out'; amountCentavos: number; reason: string } } | { kind: 'menu.availability'; payload: { itemId: string; available: boolean } })`. `occurredAt` is the till's clock (ISO) and is the shift's `opened_at`/`closed_at`, the cash move's `at` and the order's `created_at`; `staffId` is the attribution (Ruling 15).
  - `type PushResult = 'applied' | 'flagged' | 'held' | 'duplicate'`; `type PushResponse = { results: { id: string; result: PushResult; reason: string | null; flags: string[] }[]; held: number }`
  - `type PulledStaff = { id: string; fullName: string; role: 'owner' | 'manager' | 'barista'; pinHash: string }`; `type PullState = { menu: { version: number; snapshot: MenuSnapshot | null } | null; soldOut: string[]; staff: PulledStaff[]; shop: { name: string; address: string; phone: string | null } }` (`menu` null = nothing published; `snapshot` null = the till already has that version).
  - `type ImportShift = { id: string; openedAt: string; openingFloatCentavos: number; closedAt: string | null; countedCentavos: number | null; expectedCentavos: number | null; note: string; openedByStaff: string | null; closedByStaff: string | null }`; `type ImportOrder = { id: string; shiftId: string | null; businessDay: string; ticketNumber: number; fulfilment: OrderType; customerName: string; status: OrderStatus; lines: PricedLine[]; subtotalCentavos: number; discountCentavos: number; discountLabel: string | null; totalCentavos: number; payment: CounterOrderPayload['payment']; createdAt: string; voidedAt: string | null; voidReason: string | null; cancelledByStaff: string | null }`; `type ImportCashMove = { id: string; shiftId: string; kind: 'in' | 'out'; amountCentavos: number; reason: string; at: string; staffId: string | null }`; `type ImportChunk = { shifts: ImportShift[]; orders: ImportOrder[]; cashMoves: ImportCashMove[] }`; `type ImportResponse = { inserted: number; existing: number; skipped: number }`.
  - `repriceCounterOrder(snapshot: MenuSnapshot, order: Pick<CounterOrderPayload, 'lines' | 'discount' | 'subtotalCentavos' | 'discountCentavos' | 'totalCentavos'>): { matches: boolean; expected: Totals; mismatchedLines: number[] }` — prices each line against the snapshot **ignoring every `isAvailable`** (a sold-out mark never makes a counter fact wrong): item by `menuItemId` in any category, variant `code === size`, each modifier id must be an option of one of the item's groups; expected line total `(variant + options) × quantity`. A line is mismatched when anything is missing or its base, option prices or line total differ. Totals via `totals(expectedLines, cleanDiscount(discount))`; `matches` = no mismatched lines and all three totals equal.

- [ ] **Step 1: Write the failing tests** (`sync.test.ts`, with a two-version fixture: v1 latte M ₱120 + oat ₱20; v2 latte M ₱130):

```ts
test('an order priced on v1 matches v1, not v2', () => {
  const order = counterOrder({ size: 'M', base: 12000, mods: [oat(2000)], quantity: 2 }) // subtotal 28000
  expect(repriceCounterOrder(v1, order).matches).toBe(true)
  const r = repriceCounterOrder(v2, order)
  expect(r.matches).toBe(false)
  expect(r.mismatchedLines).toEqual([0])
  expect(r.expected.subtotalCentavos).toBe(30000)
})
test('sold-out marks do not matter', () => {
  expect(repriceCounterOrder(soldOut(v1, latte.id, latteM.id, oat.id), order).matches).toBe(true)
})
test('missing item, size or option is a mismatch', () => { /* unknown menuItemId; size 'XL' absent; option of another item's group */ })
test('discount is recomputed from kind and value', () => {
  expect(repriceCounterOrder(v1, { ...order, discount: { label: 'Senior', kind: 'percent', value: 20 }, discountCentavos: 5600, totalCentavos: 22400 }).matches).toBe(true)
  expect(repriceCounterOrder(v1, { ...order, discount: { label: 'Senior', kind: 'percent', value: 20 }, discountCentavos: 5000, totalCentavos: 23000 }).matches).toBe(false)
})
test('till statuses map to prep statuses', () => expect(TILL_TO_PREP.serving).toBe('ready'))
```

  Plus in `snapshot.test.ts`: `liveDrinkMenu(snapshot, 0).version` equals `snapshot.version`.
- [ ] **Step 2: Run** `npm test -w @kennko/core -- sync` — FAIL (module missing).
- [ ] **Step 3: Implement** types, constants and `repriceCounterOrder` (reuse `lineTotal`, `totals`, `cleanDiscount`).
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` (website and till still compile with the optional `version`) — PASS.
- [ ] **Step 5: Commit** `feat(core): till sync contract and counter re-pricing`

---

### Task 2: Migration 0017 — shifts, cash moves, counter orders, sync receipts

**Files:**
- Create: `apps/api/supabase/migrations/0017_till_sync.sql`, `apps/api/test/sync-schema.test.ts`

**Interfaces:**
- Produces (names exact):

```
shifts      id uuid primary key (till-generated, no default), device_id uuid not null references devices(id),
            opened_at timestamptz not null, opened_by_staff uuid references staff(id),
            opening_float_centavos int not null check (>= 0), closed_at timestamptz, closed_by_staff uuid references staff(id),
            counted_centavos int check (>= 0), expected_centavos int, note text not null default '' check (char_length(note) <= 200),
            is_legacy boolean not null default false, received_at, updated_at timestamptz not null default now(),
            constraint shifts_closed_has_count check ((closed_at is null) = (counted_centavos is null))
            unique index shifts_one_open (device_id) where closed_at is null
cash_moves  id uuid primary key, shift_id uuid not null references shifts(id), kind text not null check (kind in ('in','out')),
            amount_centavos int not null check (> 0), reason text not null check (char_length(reason) between 1 and 80),
            at timestamptz not null, staff_id uuid references staff(id), received_at timestamptz not null default now()
            index cash_moves_shift_idx (shift_id)
orders      + device_id uuid references devices(id), shift_id uuid references shifts(id), opened_by_staff uuid references staff(id)
            constraint orders_counter_device check ((channel = 'counter') = (device_id is not null))
            constraint orders_counter_only check (channel = 'counter' or (shift_id is null and opened_by_staff is null))
            index orders_counter_ticket_idx (device_id, business_day, ticket_number) where ticket_series = 'C'   -- not unique
            index orders_flagged_idx (business_day) where flags <> '{}'
payments    + device_id uuid references devices(id)
sync_events device_id uuid not null references devices(id), id uuid not null, seq bigint not null,
            kind text not null check (kind in (<the seven SyncEventKind strings>)), payload jsonb not null,
            staff_id uuid, entity_keys text[] not null, occurred_at timestamptz not null, received_at timestamptz not null,
            result text not null check (result in ('applied','flagged','held')), reason text, applied_at timestamptz,
            primary key (device_id, id)
            index sync_events_held (device_id, seq) where result = 'held'
```

- Grants: `shifts`, `cash_moves`, `sync_events`: RLS on, `revoke all from anon, authenticated`, `grant select, insert, update … to kennko_api` with one `to kennko_api` policy per command. `grant update (is_available) on menu_items to kennko_api` + policy `"api updates menu_items availability"` (`for update to kennko_api using (true) with check (true)`); the column grant is what limits it, and the existing stamp trigger sets `availability_changed_at`.

- [ ] **Step 1: Write `sync-schema.test.ts`** (seed a device and staff with plain inserts):
  - a counter `dine_in` order with `device_id` and `shift_id` succeeds; a counter order without `device_id` fails `orders_counter_device`; an online order with a `shift_id` fails `orders_counter_only`; two counter orders with the same device, day and C number both insert (no unique index);
  - a second open shift for the same device fails `shifts_one_open`; after closing the first (with `counted_centavos`) it succeeds; `closed_at` without `counted_centavos` fails `shifts_closed_has_count`;
  - a cash move with `amount_centavos = 0` fails; reason `''` fails;
  - `sync_events`: the same `(device_id, id)` twice fails; the same id on two devices succeeds; kind `'order.deleted'` fails;
  - privileges: `has_table_privilege` false for `anon`/`authenticated` (SELECT) on all three tables, true for `kennko_api` SELECT/INSERT/UPDATE, false for DELETE; `has_column_privilege('kennko_api', 'menu_items', 'is_available', 'UPDATE')` true and for `'name'` false.
- [ ] **Step 2: Run** `npm test -w @kennko/api -- sync-schema` — FAIL.
- [ ] **Step 3: Write the migration.** Order: `shifts` → `cash_moves` → `orders`/`payments` columns, checks and indexes (no existing counter rows, so the checks validate) → `sync_events` → RLS, revokes, grants, policies.
- [ ] **Step 4: Run** root `npm test` (every earlier schema test still passes) + `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(api): migration 0017 — shifts, cash moves, counter orders, sync receipts`

---

### Task 3: `POST /v1/sync/push` — the engine, shifts, cash and sold-out

**Files:**
- Create: `apps/api/src/sync/schema.ts`, `apps/api/src/sync/push.ts`, `apps/api/src/sync/apply.ts`, `apps/api/src/routes/sync.ts`, `apps/api/test/sync-helpers.ts`, `apps/api/test/sync-push.test.ts`
- Modify: `apps/api/src/create-app.ts` (`app.route('/v1/sync', syncRoutes(deps))`), `apps/api/README.md` (endpoint list)

**Interfaces:**
- Consumes: Task 1 types and constants; Task 2 schema; Plan 3 `requireDevice` (`c.var.device`).
- Produces:
  - `schema.ts`: `envelopeSchema` (`{ id: uuid, seq: int ≥ 1, kind: enum, occurredAt: ISO string, staffId: uuid | null, payload: unknown }`), `pushBodySchema` (`{ events: envelope[] }`, 1–`MAX_PUSH_EVENTS`), and one zod schema per payload kind (`satisfies z.ZodType<…>` against the core types).
  - `apply.ts`: `type Applied = { result: 'applied' | 'flagged' | 'held'; reason: string | null; flags: string[] }`; `entityKeys(event): string[]`; `applyEvent(tx, deviceId: string, event: SyncEvent, now: Date): Promise<Applied>` — dispatch table; this task implements `shift.opened` (insert `on conflict (id) do nothing`; `shifts_one_open` violation → held `another_shift_open`), `shift.closed` (update where `closed_at is null`; already closed → applied `already_closed`; missing → held `shift_unknown`), `cash.moved` (insert `on conflict (id) do nothing`; missing shift → held `shift_unknown`), `menu.availability` (`update menu_items set is_available` when `itemId` is a uuid; no row → flagged `unknown_item`). `staffId` not in `staff` → stored null, reason `unknown_staff`. Order kinds return held `not_supported` until Task 4.
  - `push.ts`: `pushEvents(deps, deviceId: string, raw: unknown[]): Promise<PushResponse>` — `deps.sql.begin(async tx => …)`: take the advisory lock (Ruling 2); retry this device's held rows (`order by seq limit MAX_HELD_RETRY`), each in `tx.savepoint`, updating `result/reason/applied_at` when no longer held; then for each new event in array order: `select 1 from sync_events where device_id and id` → `duplicate`; else payload validation (fail → held `invalid: <first zod issue>`); else held if `entity_keys && <keys>` matches an earlier held row of this device; else `applyEvent` inside `tx.savepoint` (a thrown error rolls back the savepoint and becomes held `invalid: <pg message>`); then insert the `sync_events` row (payload, keys, `received_at = now`, `applied_at` unless held). Returns results in request order and `held` = this device's held count after the run.
  - Route `POST /v1/sync/push` (`requireDevice`): envelope or size failure → 400 `INVALID`; success → 200 `PushResponse`, `Cache-Control: no-store`.
  - `sync-helpers.ts`: `seedDevice(sql) → { deviceId, token }`, `seedStaff`, `publishTwoVersions(sql)` (v1/v2 as in Task 1), event builders `shiftOpened(over)`, `cashMoved(over)`, `orderCreated(over)`, … with fresh uuids and increasing `seq`.

- [ ] **Step 1: Write `sync-push.test.ts`:**
  - open shift, cash in, cash out, close shift in one push → four `applied`; the `shifts` row has `opened_at`/`closed_at` = the events' `occurredAt`, `opened_by_staff`/`closed_by_staff` = their `staffId`, `expected_centavos` as sent; two `cash_moves` with `staff_id`;
  - **Review Focus 1:** the same body pushed again → four `duplicate`, row counts unchanged; `Promise.all` of two identical pushes → one response all `applied`, the other all `duplicate`, one `shifts` row (sequential on PGlite; the advisory lock plus the `sync_events` primary key are the guarantee, see Self-review notes);
  - **Review Focus 3:** push `cash.moved` for shift S alone → `held` `shift_unknown`, `held: 1`, no `cash_moves` row; push `shift.opened` S → its own result `applied` and the cash move now exists, `held: 0`, its `sync_events.result` is `applied` with `applied_at` set; a `shift.closed` for S sent in the same push as an earlier held event on S is held `waits_for_earlier`;
  - a second `shift.opened` for the device while one is open → held `another_shift_open`;
  - `menu.availability` off then on for a real item → `menu_items.is_available` false then true and `availability_changed_at` set; a slug item id → `flagged` `unknown_item`; **Review Focus 6 (API half):** admin sets the item available, then a till event received later sets it unavailable → unavailable (receive order);
  - a payload with `openingFloatCentavos: -1` → held `invalid: …`, other events in the push still applied;
  - an unknown `staffId` → applied, stored null, reason `unknown_staff`;
  - 51 events → 400; no token → 401; a revoked device → 401 `DEVICE_REVOKED`.
- [ ] **Step 2: Run** `npm test -w @kennko/api -- sync-push` — FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(api): sync push with per-device lock, receipts and held retries`

---

### Task 4: Counter orders through push — stored, flagged, never refused

**Files:**
- Create: `apps/api/src/sync/counter-order.ts`, `apps/api/test/sync-orders.test.ts`
- Modify: `apps/api/src/sync/apply.ts` (three order kinds), `apps/api/src/orders/actions.ts` (Ruling 7), `apps/api/test/orders-actions.test.ts`

**Interfaces:**
- Consumes: Task 1 `repriceCounterOrder`, `TILL_TO_PREP`; `readMenuVersion` (`menu/read.ts`); `manilaDay`; `SIZE_LABELS`.
- Produces in `counter-order.ts`:
  - `applyOrderCreated(tx, deviceId, event, now): Promise<Applied>` — shift missing → held `shift_unknown`. Arithmetic checks in JS before any insert (`total = subtotal − discount`, `discount ≤ subtotal`, cash `tendered − change = total`, every line total consistent with its own base/options/quantity) → failure held `invalid: totals` (Ruling 4). Flags: `menuVersion` null or not in `menu_snapshots` → `unknown_version` (column stored null); else `repriceCounterOrder` not matching → `reprice_mismatch`; another order with the same `device_id`, `business_day`, series `C`, `ticket_number` → `ticket_duplicate`; `|businessDay − manilaDay(now)| > 1 day` → `clock_skew`. Inserts in order: `orders` (`channel 'counter'`, `ticket_series 'C'`, `prep_status 'placed'`, `payment_status 'paid'`, `business_day`, `device_id`, `shift_id`, `opened_by_staff` = the shift's, `created_at = occurredAt`, `received_at = now`, discount label/kind/value, `flags`), `order_lines` (`item_id`/`variant_id` only when a uuid present in the menu tables, else null; `variant_code = size`, `variant_label` from the snapshot variant or `SIZE_LABELS`), `order_line_options` (`option_id` likewise; `group_name` from the snapshot or `''`), `payments` (id from the till, `status 'recorded'`, `amount = total`, tendered/change for cash, `reference` for GCash, `device_id`), `order_events` (id = event id, `device_id`, kind `created`, `to_value 'placed'`, `staff_id`, `result` `flagged` when any flag else `applied`, `reason` = flags joined by `,`). Result `flagged` with `flags` when any flag.
  - `applyPrepStatus(tx, deviceId, event, now)` — order missing → held `order_unknown`; online order → flagged `online_order`, no change (Plan 5); cancelled → applied `already_cancelled`, no change; else `update orders set prep_status = to` and an `order_events` row (`from_value` = previous).
  - `applyCancelled(tx, deviceId, event, now)` — order missing → held `order_unknown`; already cancelled → applied `already_cancelled`; else in the savepoint: order `prep_status 'cancelled'`, `payment_status 'refunded'`, `cancelled_at = occurredAt`, `cancelled_by_staff`, `cancel_reason`; live payment `refunded`; `order_events` kind `cancelled`.
  - `entityKeys`: `order.created` → `['order:<id>', 'shift:<shiftId>']`; prep/cancel → `['order:<id>']`.
  - `actions.ts`: `PATCH /v1/orders/:id` with `prepStatus` on a counter order → 409 `COUNTER_ORDER` "Counter orders are updated at the till." (staff notes still allowed).

- [ ] **Step 1: Write `sync-orders.test.ts`** (`publishTwoVersions`; an open shift pushed first; `now` pinned to `2026-11-21T02:00:00Z`):
  - an order priced on v2 with `menuVersion 2` → `applied`, no flags; one row each in `orders` (`opened_by_staff` = shift opener), `order_lines` (real `item_id`, `variant_id`, label `Medium`), `order_line_options` (`group_name 'Milk of Choice'`), `payments` (`recorded`, amount = total), `order_events` (`created`);
  - **re-pricing against an old snapshot:** priced on v1 with `menuVersion 1` after v2 is published → `applied`, no flag, `menu_version 1`; the same v1 prices sent with `menuVersion 2` → `flagged` `['reprice_mismatch']`, stored with the till's totals untouched;
  - **Review Focus 2:** `menuVersion 99` → flagged `unknown_version`, `menu_version` null; `menuVersion null` with slug item ids (built-in menu) → flagged `unknown_version`, lines with null `item_id`/`variant_id`/`option_id` and the sent names; a second order with the same C number and day → flagged `ticket_duplicate` (both rows exist); `businessDay '2026-11-18'` → flagged `clock_skew`; an order whose v2 item is sold out in admin → `applied` (sold-out is ignored); every one of these is answered and the till would delete it;
  - **Review Focus 1:** the same `order.created` pushed twice → second `duplicate`; still one row in each of the five tables;
  - **Review Focus 3:** `order.prep_status` for an unknown order → held `order_unknown`; a later `order.cancelled` for it → held `waits_for_earlier`; then `order.created` arrives → all three end applied in seq order: order `cancelled` + `refunded`, payment `refunded`, three `order_events` rows;
  - prep `placed → preparing → ready → completed` in one push → final `completed`, three `prep_status` events; a prep change after cancel → `already_cancelled`, still cancelled;
  - impossible totals (`total ≠ subtotal − discount`) → held `invalid: totals`, no `orders` row, other events applied;
  - `orders-actions.test.ts`: owner `PATCH { prepStatus: 'preparing' }` on a counter order → 409 `COUNTER_ORDER`; `PATCH { staffNote }` → 200.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(api): counter orders through sync, flagged and never refused`

---

### Task 5: `GET /v1/sync/pull` — state for the till

**Files:**
- Create: `apps/api/src/sync/pull.ts`, `apps/api/test/sync-pull.test.ts`
- Modify: `apps/api/src/routes/sync.ts`, `apps/api/README.md`

**Interfaces:**
- Produces:
  - `readPullState(sql, tillVersion: number | null): Promise<PullState>` — latest `menu_snapshots` version (none → `menu: null`); `snapshot` = `readMenuVersion(latest)` (as published, no overlay) only when `tillVersion` is null or lower; `soldOut` = ids from `menu_items`, `menu_variants`, `options` where `not is_available` (sorted); `staff` = same query and shape as `/v1/devices/me`; `shop` = `shop_settings` `display_name`, `address`, `phone`.
  - `GET /v1/sync/pull?version=N` (`requireDevice`) → 200 `PullState`, `Cache-Control: no-store`. A `version` that is not a positive integer is treated as absent. The till ignores keys it does not know (Plan 5 adds `onlineOrders`).

- [ ] **Step 1: Write `sync-pull.test.ts`:** no snapshot → `menu: null`; after v1 and v2: no `version` → `{ version: 2, snapshot: <v2 body with version 2> }`; `?version=1` → snapshot present; `?version=2` → `snapshot: null`; `?version=abc` → snapshot present; marking one item, one variant and one option unavailable → all three ids in `soldOut`; staff: only active with a PIN (seed three as in Plan 3's test) and never an `email` or `user_id` key; `shop.name` = `'Kennko Coffee'` and no `receipt_footer` key; revoked device → 401.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(api): sync pull returns menu, sold-out, staff and shop state`

---

### Task 6: `POST /v1/sync/import` — legacy history in chunks

**Files:**
- Create: `apps/api/src/sync/import.ts`, `apps/api/test/sync-import.test.ts`
- Modify: `apps/api/src/routes/sync.ts`, `apps/api/README.md`

**Interfaces:**
- Consumes: Task 1 `ImportChunk`, `TILL_TO_PREP`; `SIZE_LABELS`.
- Produces:
  - `importChunk(deps, deviceId, chunk: ImportChunk): Promise<ImportResponse>` — one transaction under the same advisory lock as push; at most `IMPORT_CHUNK_MAX` rows across the three arrays (else 400). Shifts first, then orders, then cash moves; every insert `on conflict do nothing` (no target, so `shifts_one_open` is covered too) and counted as `inserted` or `existing`.
    - Shifts: `is_legacy true`, `device_id`, the sent times, amounts and staff (unknown staff → null).
    - Orders (spec's import rules): `channel 'counter'`, `ticket_series 'C'`, `menu_version` null, `flags '{legacy}'`, `prep_status = TILL_TO_PREP[status]`, `payment_status` `refunded` when voided else `paid`; `cancelled_at = voidedAt`, `cancel_reason`, `cancelled_by_staff`; `discount_label` kept, `discount_kind`/`discount_value` null; `shift_id` only when that shift exists (else null); lines and options as name snapshots with null `item_id`/`variant_id`/`option_id`, `variant_label` from `SIZE_LABELS`, `group_name ''`; payment `recorded` (or `refunded` when voided) with the till's payment id. Never re-priced. No `order_events` rows.
    - Cash moves: shift missing → counted `skipped` (Ruling 10).
  - `POST /v1/sync/import` (`requireDevice`) → 200 `ImportResponse`; malformed → 400 `INVALID`.

- [ ] **Step 1: Write `sync-import.test.ts`:**
  - a chunk with one closed shift, three orders (one `done`, one `voided`, one `serving`) and one cash move → `inserted 5`; the voided order is `cancelled` + `refunded` with a `refunded` payment; the serving one is `ready` + `paid`; all three carry `legacy`, `menu_version` null and null menu refs;
  - **Review Focus 5 / run twice:** the same chunk again → `inserted 0, existing 5`; row counts in `shifts`, `orders`, `order_lines`, `order_line_options`, `payments`, `cash_moves` unchanged;
  - an open legacy shift when the device already has an open shift → `existing`, no error; its orders then import with `shift_id` null;
  - a cash move for an unknown shift → `skipped 1`, the rest inserted;
  - 101 rows → 400; revoked device → 401.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` + `npm run build -w @kennko/api` (load `server.js` with dummy env as in earlier plans) — PASS.
- [ ] **Step 5: Commit** `feat(api): one-time import of till history`

---

### Task 7: Till — UUIDs, attribution and the outbox in the same transaction

**Files:**
- Create: `apps/pos/test/outbox.test.ts`
- Modify: `apps/pos/server/store.ts`, `apps/pos/test/store.test.ts` (new `by` arguments), `packages/core/src/order.ts` (optional display fields)

**Interfaces:**
- Produces in `store.ts`:
  - Schema upgrade, idempotent, run in `createStore` (columns added only when `pragma table_info` lacks them; uniqueness through `create unique index if not exists`, since SQLite cannot add a UNIQUE column): `shifts` + `uid`, `opened_by_staff`, `closed_by_staff`, `needs_import`; `orders` + `uid`, `payment_uid`, `menu_version`, `cancelled_by_staff`, `needs_import`; `cash_moves` + `uid`, `staff_id`, `needs_import`; new tables `outbox (seq integer primary key autoincrement, id text not null unique, kind text not null, entity text not null check (entity in ('order','shift','cash_move','menu')), entity_local_id integer, staff_id text, occurred_at integer not null, payload text not null)` and `kv (key text primary key, value text not null)`. When `kv.schema` is absent: in one transaction set `needs_import = 1` on every existing row, then `schema = '4'` (Ruling 9). A fresh database just sets the marker.
  - `type By = string | null` (staff id). Every write gains a trailing `by: By` and writes its outbox row inside the same `tx`: `createOrder(menu, input, now, by)` → `uid`/`payment_uid` = `randomUUID()`, `menu_version = menu.version ?? null`, outbox `order.created`; `advance`/`undo(id, now, by)` → `order.prep_status` with `to = TILL_TO_PREP[new status]`; `voidOrder(id, reason, now, by)` → `cancelled_by_staff`, outbox `order.cancelled`; `startShift(float, now, by)` → `opened_by_staff`, `shift.opened`; `cashMove(kind, amount, reason, now, by)` → `staff_id`, `cash.moved`; `endShift(counted, note, now, by)` → `closed_by_staff`, `shift.closed` with `expectedCentavos` from the shift summary; `setAvailable(itemId, available, now, by, opts: { outbox: boolean })` → `menu.availability` only when `opts.outbox` (Ruling 14).
  - Outbox payloads hold no foreign UUIDs (Ruling 8). `outboxEvents(limit = MAX_PUSH_EVENTS): SyncEvent[]` reads rows by `seq`, fills `orderId`/`shiftId`/cash-move `id` from the entity rows' `uid` (and the order's shift uid), and **stops at the first row whose UUIDs are not all known** so order is kept. `ackOutbox(ids: string[]): void`; `pending(): { sales: number; events: number }` (`sales` = `order.created` rows); `kvGet(key): string | null`; `kvSet(key, value): void`.
  - `toOrder` adds `voidedByName: string | null` and `toMove` adds `staffName: string | null` (left join on `staff_cache`); `Order` and `CashMove` in core gain these as optional fields.

- [ ] **Step 1: Write `outbox.test.ts`** (`createStore(':memory:')`, `builtInMenu`):
  - each write adds exactly one outbox row of the right kind with `staff_id` = `by`, `occurred_at` = `now`; `outboxEvents()` returns them in order with uuids filled (`order.created.payload.shiftId` = the shift's `uid`, `payment.id` = `payment_uid`, `menuVersion` null for the built-in menu, a snapshot-derived menu with `version: 3` gives `3`);
  - a write that throws (`createOrder` with the till closed, `voidOrder` twice, `cashMove` with no reason) leaves the outbox unchanged — **same transaction**;
  - `setAvailable(…, { outbox: false })` changes `sold_out` and adds nothing;
  - `ackOutbox` removes only the given ids; `pending()` counts `sales` and `events`;
  - **upgrade:** build a file database with today's schema (the `SCHEMA` text before this task, copied into the test) holding one shift, two orders and a cash move; open it with the new `createStore` → all four rows `needs_import = 1`, `uid` null, `kv.schema = '4'`; reopening does not re-mark rows created after the upgrade;
  - **Review Focus 4 (till half):** an outbox row whose order `uid` is null (a legacy order advanced after the upgrade) blocks `outboxEvents()` at that row; rows before it are returned;
  - `store.test.ts`: existing tests pass with `by` = `null`; a void credited to a cached person shows `voidedByName`.
- [ ] **Step 2: Run** `npm test -w @kennko/pos` — FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` — PASS. (`index.ts` passes `null` for `by` until Task 10.)
- [ ] **Step 5: Commit** `feat(pos): outbox written with every change, UUIDs and attribution`

---

### Task 8: Till — the sync loop: push, pull, clock, backoff

**Files:**
- Create: `apps/pos/server/sync.ts`, `apps/pos/test/sync.test.ts`
- Modify: `apps/pos/server/device.ts` (`applyDeviceInfo` also accepts `{ status: 'ok'; staff }` built from the pull; `fetchDeviceInfo` stays until Task 10 so `index.ts` keeps compiling), `apps/pos/server/menu.ts` (`saveSnapshot`, `loadSnapshot`), `apps/pos/server/store.ts` (`replaceSoldOut`)

**Interfaces:**
- Consumes: Task 1 contract; Task 5 pull; Task 7 outbox; Plan 3 `loadDevice`, `saveDevice`, `applyDeviceInfo`.
- Produces:
  - `store.replaceSoldOut(ids: string[]): void` — one transaction: `sold_out` := `ids`, then replays unsent `menu.availability` outbox rows in `seq` order (Ruling 14).
  - `menu.ts`: `saveSnapshot(dataDir, s: MenuSnapshot)` (`data/menu-snapshot.json`, tmp + rename), `loadSnapshot(dataDir): MenuSnapshot | null` (shape-checked).
  - `sync.ts`:
    - `type SyncStatus = { paired: boolean; revoked: boolean; offline: boolean; pendingSales: number; pendingEvents: number; lastSyncAt: number | null; clockSkewMs: number | null; problem: string | null; menuVersion: number | null }`
    - `clockSkew(res: Response, sentAt: number, receivedAt: number): number | null` — `Date` header minus the request's midpoint; null without a header.
    - `nextDelay(failures: number): number` — `SYNC_EVERY_MS` at 0, else `BACKOFF_MS[min(failures − 1, 4)]`.
    - `createSync(opts: { store: Store; sessions: Sessions; pins: PinDirectory; dataDir: string; apiUrl: string; fetchFn?: typeof fetch; now?: () => number; timers?: { set: typeof setTimeout; clear: typeof clearTimeout }; onChange: (what: { menu: boolean; staff: boolean; status: boolean }) => void })` → `{ start(): void; kick(): void; runOnce(): Promise<void>; status(): SyncStatus; stop(): void }`.
    - `runOnce` (one at a time; a `kick` during a run queues exactly one more): unpaired or revoked → status only. Otherwise push while `outboxEvents()` is non-empty (`POST <api>/v1/sync/push`, `Authorization: Bearer <token>`, 15 s timeout; `ackOutbox` every id in `results`), then pull (`GET <api>/v1/sync/pull?version=<loaded snapshot version>`): `menu.snapshot` → `saveSnapshot` + `onChange({ menu: true })`; `replaceSoldOut(soldOut)`; `applyDeviceInfo(…, { status: 'ok', staff })`; shop → `kvSet('shop', JSON)`. Every response updates `clockSkewMs`. 401 with `DEVICE_REVOKED`/`UNAUTHENTICATED` → `saveDevice({ …, revokedAt })` and stop pushing (the till keeps selling, Plan 3 Ruling 10). Network error, timeout, 5xx or 400 → `offline: true`, `problem` set, failures + 1. Success → failures 0, `lastSyncAt`.
    - Scheduling: `start()` runs at once, then after each run waits `nextDelay(failures)`; `kick()` runs after `KICK_DEBOUNCE_MS` and resets the timer.

- [ ] **Step 1: Write `sync.test.ts`** (fake `fetch` recording requests, fake timers, temp data dir, paired `device.json`):
  - 120 outbox rows → three pushes of 50, 50, 20 in `seq` order, then one pull; outbox empty after; `results` with `held`, `flagged` and `duplicate` also delete their rows;
  - **Review Focus 4:** push answers 503 → nothing deleted, `offline: true`, next run after 15 s, then 30, 60, 120, 300, 300 s; a success resets to 15 s; a response lost after the server applied it (fake returns `duplicate` on the retry) still empties the outbox; `pending()` drives `pendingSales`;
  - pull with a snapshot → `menu-snapshot.json` written and `onChange` called with `menu: true`; with `snapshot: null` → file untouched; the request carries `?version=` of the loaded file;
  - **Review Focus 6:** server `soldOut: []` while an unsent `menu.availability` off for item X waits in the outbox (push failed) → X stays sold out after the pull; once pushed and the next pull lists X, it is still off; a server mark on Y with nothing pending → Y sold out;
  - staff from the pull replace the cache and end sessions of people no longer listed (via `applyDeviceInfo`);
  - clock: `Date` header 7 minutes ahead → `clockSkewMs ≈ 420000`; no header → null;
  - 401 `DEVICE_REVOKED` → `device.json` gets `revokedAt`, later runs send nothing; unpaired → no fetch at all;
  - `kick()` three times within 300 ms → one run.
- [ ] **Step 2: Run** `npm test -w @kennko/pos` — FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(pos): sync loop pushes the outbox and pulls menu, sold-out, staff and shop`

---

### Task 9: Till — one-time import of pos.db history

**Files:**
- Create: `apps/pos/server/uuid5.ts`, `apps/pos/server/legacy-import.ts`, `apps/pos/test/legacy-import.test.ts`
- Modify: `apps/pos/server/sync.ts` (import step before push)

**Interfaces:**
- Consumes: Task 1 `ImportChunk`, `IMPORT_CHUNK_MAX`; Task 6 contract; Task 7 columns.
- Produces:
  - `uuid5(namespace: string, name: string): string` (RFC 4122 v5, SHA-1 from `node:crypto`); `KENNKO_TILL_NS` (Ruling 9).
  - `assignLegacyIds(store, deviceId: string): number` — one transaction: for rows with `uid` null, `uid = uuid5(NS, "<deviceId>:<table>:<localId>")` (`table` ∈ `shifts`, `orders`, `cash_moves`) and orders' `payment_uid = uuid5(NS, "<deviceId>:payments:<localId>")`; returns how many were set. Never touches a row that has a `uid`.
  - `nextImportChunk(store): { chunk: ImportChunk; upTo: number; rows: { table: string; localId: number }[] } | null` — rows with `needs_import = 1` and a `uid`: all shifts first, then orders by id, then cash moves, at most `IMPORT_CHUNK_MAX` per chunk; `upTo` = `max(outbox.seq)` read in the same transaction; closed shifts carry `expectedCentavos` from `shiftSummary`; orders carry their lines, payment and local attribution (Ruling 10).
  - `ackImportChunk(store, rows, upTo): void` — one transaction: `needs_import = 0` for those rows and delete outbox rows whose entity is one of them with `seq <= upTo` (Ruling 9).
  - `sync.ts` `runOnce`: `assignLegacyIds(device.deviceId)`, then while `nextImportChunk` → `POST /v1/sync/import` → `ackImportChunk`; a failure stops the run like a push failure (import always finishes before any push). `kv.import_done = '1'` when none remain; `SyncStatus` gains `importing: number` (rows left).

- [ ] **Step 1: Write `legacy-import.test.ts`:**
  - `uuid5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com')` = `'2ed6657d-e927-568b-95e1-2665a8aea6a2'`;
  - an upgraded database (as in Task 7) → `assignLegacyIds(D)` sets four uids, a second call sets 0, and the uids equal `uuid5(NS, 'D:orders:1')` etc.; a fresh store + `assignLegacyIds` with another device id after the first never changes them;
  - chunks: 250 legacy orders and 1 shift → chunks of 100 (shift + 99 orders), 100, 51 in that order; the voided order's `status` is `voided` with `voidedAt`;
  - **Review Focus 5:** a legacy order voided after the upgrade (outbox `order.cancelled`, `seq 7`), then a chunk read with `upTo 7` and acked → that outbox row is gone and the chunk carries `status: 'voided'`, `cancelledByStaff`; an advance written after the chunk was read (`seq 8`) survives the ack and is sent by the next push;
  - run twice: acked rows never appear again; resetting `needs_import = 1` on all rows yields chunks with byte-identical ids (so the API answers `existing`);
  - wired into the loop with fake fetch: import requests come before any push; a 503 on the second chunk leaves rows 101+ pending and pushes nothing; the next run resumes at row 101.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(pos): one-time import of pos.db history with stable UUIDs`

---

### Task 10: Till server — sync wired in, menu from the snapshot, credited actions

**Files:**
- Modify: `apps/pos/server/index.ts`, `apps/pos/server/menu.ts` (`tillMenu`), `apps/pos/test/menu.test.ts`, `apps/pos/src/api.ts` (types only: `Live.sync`, `Bootstrap` unchanged shape)

**Interfaces:**
- Consumes: Tasks 7–9.
- Produces:
  - `menu.ts`: `tillMenu(snapshot: MenuSnapshot | null, fallback: Menu, soldOut: Set<string>, now: number): Menu` — snapshot → copy, mark items/variants/options in `soldOut` unavailable, `liveDrinkMenu` (carries `version`); no snapshot → `fallback` (old `menu.json` or built-in) with item-level marks. `fetchApiMenu` now returns the raw `MenuSnapshot` (manual pull for unpaired tills, Ruling 11). `tillDiscounts(snapshot, config.discounts): Discount[]` (Ruling 13).
  - `index.ts`:
    - `refreshStaff`, its 5-minute timer and `fetchDeviceInfo` (+ its tests in `device.test.ts`) are removed; `const sync = createSync({ …, onChange })` starts with the server; `onChange({ menu })` reloads the snapshot; every `onChange` calls `broadcast()`. Pairing calls `await sync.runOnce()` where it called `refreshStaff()`. Every successful write route calls `sync.kick()` after its response is sent (`done()` does it).
    - `menu()` = `tillMenu(loadedSnapshot, baseMenu, new Set(store.soldOut()), now)`; `menuKey` includes the snapshot version.
    - `needSession(req): Who | null` returns the session; writes pass `by` per Ruling 15: `createOrder`, `startShift`, cash in, `advance`/`undo` → session `staffId`; void, cash out, close → the `Who` returned by `checkPin(…, 'manager')`.
    - `POST /api/menu/availability`: in `per-person` mode requires `body.pin` through `checkPin(req, body.pin, 'staff')` and credits that person; otherwise credits the session; `setAvailable(…, { outbox: loadDevice(DATA)?.revokedAt === null })`.
    - `POST /api/menu/sync`: paired and not revoked → `await sync.runOnce()` (no PIN), answers the menu or `OrderError(status().problem)`; unpaired → today's manager-PIN path, saving the snapshot.
    - Bootstrap: `shop` = `{ ...config.shop, ...kv shop }` (footer from config, Ruling 12); `discounts` = `tillDiscounts`; new `syncConfigured: boolean`.
    - Live snapshot gains `sync: SyncStatus`. Startup log prints `Sync:` (paired / pending / importing) in place of the staff refresh line.
  - `api.ts`: `Live` gains `sync: SyncStatus` (type copied, not imported from server code); `setAvailable(itemId, available, pin?)`; `syncMenu(managerPin?)`.

- [ ] **Step 1: Write the failing tests** in `menu.test.ts`: `tillMenu` with a snapshot and `soldOut` = {item A, variant B-L, option oat} → A unavailable, B has no `L` price, oat unavailable, `version` set; without a snapshot → the fallback with A unavailable and no `version`; `tillDiscounts` → presets when present, config otherwise; `loadSnapshot` on a garbled file → null.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** `menu.ts` changes and the `index.ts` wiring.
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` + `npm run build -w @kennko/pos` — PASS. Manual check with `npm run pos` and no API configured: sell, void, open/close the till — nothing waits, `sync.paired` false, outbox rows accumulate (`sqlite3 data/pos.db 'select kind from outbox'`).
- [ ] **Step 5: Commit** `feat(pos): sync wired into the till, menu from the snapshot, actions credited`

---

### Task 11: Till screens — offline badge, clock warning, sold-out PIN, names

**Files:**
- Modify: `apps/pos/src/App.tsx`, `apps/pos/src/screens/MenuScreen.tsx`, `apps/pos/src/screens/History.tsx`, `apps/pos/src/screens/Till.tsx`, `apps/pos/src/styles.css`, `apps/pos/README.md`
- Create: `apps/pos/src/syncText.ts`, `apps/pos/test/syncText.test.ts`

**Interfaces:**
- Produces:
  - `syncText.ts`: `offlineBadge(s: SyncStatus): string | null` (Ruling 16: `"Offline: 12 sales waiting to send"`, `"Offline: 1 sale waiting to send"`, `"Offline: changes waiting to send"`, null when unpaired, revoked or not offline); `clockWarning(s: SyncStatus): string | null` (`|clockSkewMs| > CLOCK_WARN_MS` → `"This computer's clock is 7 minutes behind. Sales still work; fix the time in Windows settings so reports line up."`, "ahead" when positive); `menuLine(s, menu): string` (`"Prices from Kennko, version 12, checked 2 min ago."`, `"Using the menu that came with the till."`, or `"Copying sales history to Kennko: 140 left."` when importing).
  - `App.tsx`: under the existing "Lost touch" banner, an amber pill with `offlineBadge` and one with `clockWarning` (`role="status"`, never a modal); the rail's Orders badge is unchanged.
  - `MenuScreen.tsx`: header button **Check now** when paired (calls `api.syncMenu()`, toast "The menu is up to date."), **Update from website** (manager PIN, as today) when unpaired; the line from `menuLine`; in `per-person` mode a switch opens `PinPrompt` titled "Your PIN" with hint "Marking a drink sold out is credited to you."
  - `History.tsx`: a voided order shows "Voided by {first name}" when `voidedByName` is set. `Till.tsx`: each cash move shows "by {first name}" when set.
  - README: a "Sync" section (what syncs, the badge, the clock warning, the one-time import, sold-out rule, where the outbox lives) replacing the 5-minute staff refresh text.

- [ ] **Step 1: Write `syncText.test.ts`:** singular/plural sales; events-only text; null when online, unpaired or revoked; clock 7 min behind/ahead; 4 min → null; `menuLine` for snapshot, built-in and importing.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (amber pill uses the brand amber, blue `#0055FF` for the Check now button, no dark styles).
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` + `npm run build -w @kennko/pos` — PASS. Check at 768 and 1024 px (tablet widths): the pills wrap without covering the sell grid.
- [ ] **Step 5: Commit** `feat(pos): offline badge, clock warning, sold-out PIN and who-did-it names`

---

### Task 12: Deploy checklist

**Files:** `apps/api/README.md` (a "Plan 4" section with the steps below). Nothing is run by the implementer: Julius applies the migration and deploys.

- [ ] **Step 1:** Root `npm test`, `npm run typecheck`, `KENNKO_API_URL= npm run build -w @kennko/web`, `npm run build -w @kennko/api` (load `server.js` with dummy env), `npm run build -w @kennko/pos` on the branch tip.
- [ ] **Step 2: Write the checklist** into the README, in this order:
  1. **Migration** `0017_till_sync.sql` (Julius, from `apps/api`, dry run first; it must list only 0017). Additive; the deployed API and website keep working.
  2. **API** deploy. No new environment variables. Smoke: `/health` 200; `POST /v1/sync/push` with `Bearer kd_x` → 401; `GET /v1/sync/pull` without a token → 401; `GET /v1/devices/me` still answers the current till (it stays for tills not yet upgraded).
  3. **Website:** no change in this plan (admin already lists online orders only).
  4. **Till** (shop computer): close the till first if possible, take a manual backup copy of `data/pos.db`, pull, `npm run pos:build`, restart. The startup log shows `Sync: importing N rows`, then `Sync: up to date`. Check in Supabase (Julius, read-only): `select count(*) from orders where 'legacy' = any(flags)` equals the till's order count; running the till again imports nothing new.
  5. **Live checks:** ring a ₱ test sale → within seconds an `orders` row with `channel 'counter'` and no flags; void it with the owner's PIN → `cancelled` + `refunded`, `cancelled_by_staff` = the owner; mark a drink sold out on the till → admin shows it sold out; switch it back in admin → the till follows within 15 s; pull the shop computer's network cable, ring two sales → "Offline: 2 sales waiting to send"; reconnect → the badge clears and both rows arrive once.
  6. **Menu:** publish a price change in admin → the till's Menu screen shows the new version within 15 s without a PIN.
- [ ] **Step 3: Commit** `docs(api): plan 4 deploy checklist`

## Self-review notes

- Spec coverage for roadmap row 4: `shifts` + `cash_moves` ✔ (2, 3), counter columns `device_id`/`shift_id`/`opened_by_staff`, C series, flags ✔ (2, 4), `order_events unique (device_id, id)` used for order events ✔ (1 ruling, 4), push with per-device advisory lock, ≤ 50 events, per-event transaction, applied/flagged/held/duplicate, held retried ✔ (3), counter orders always stored and flagged (`reprice_mismatch`, `unknown_version`, `ticket_duplicate`, `clock_skew`) ✔ (4), pull as state (snapshot if newer, sold-out, staff PIN hashes, shop) with room for Plan 5 ✔ (5), outbox in the same SQLite transaction ✔ (7), loop after each change / 15 s / backoff ✔ (8), offline badge ✔ (11), clock check vs `Date` header ✔ (8, 11), menu from the pulled snapshot building on Plan 1's `liveDrinkMenu` ✔ (10), attribution of voids, cash moves, closes ✔ (7, 10), sold-out PIN ✔ (10, 11), one-time import with UUIDv5, separate chunked endpoint, `legacy`, voids as cancelled + refunded, run twice harmless ✔ (6, 9). Must-have tests: push idempotency and concurrent retries (3, 4), held events (3, 4), counter orders flagged never refused (4), re-pricing against an old snapshot (1, 4), the import run twice (6, 9).
- Deferred by design: online orders in the pull and queue (Plan 5), admin views of flags and held events (Plan 6), food on the till's sell screen, dropping `GET /v1/devices/me`.
- Concurrency limit: PGlite shares one backend session, so concurrent pushes run sequentially in tests; correctness rests on `pg_advisory_xact_lock` per device plus the `sync_events` primary key (a bug turns into a failed insert, never a double-applied event).
- Known limit: a till whose clock is wrong stamps `occurredAt` wrong; `received_at` is always the server's, and `clock_skew` plus the till's warning make it visible.
