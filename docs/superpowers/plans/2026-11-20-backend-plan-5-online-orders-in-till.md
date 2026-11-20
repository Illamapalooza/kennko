# Backend Plan 5: Paid Online Orders in the Till Queue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A paid online order shows up in the till's queue next to the counter orders within one sync, the barista moves it through prep from the till (online or offline), and the customer gets the same push notification as when admin moves it. The till never receives an email, GCash reference or receipt, and never cancels or refunds an online order.

**Architecture:** The sync pull gains an `onlineOrders` key: paid online orders that are unfinished or were updated in the last 24 hours, read through an explicit column allowlist (`apps/api/src/sync/online-orders.ts`). The till keeps them in a separate SQLite table `online_orders`, so they never touch its sales, cash or C numbers. The till moves one through prep by writing an `order.prep_status` outbox row carrying the server's order id. The push applies it with the same rule admin uses (`canMovePrep`), in the order the server receives the changes, and sends the customer push through `notifyOrder` after the push transaction commits (`deps.defer`). Each pull replaces the till's copy and then replays the till's unsent steps on top, the same way Plan 4 replays sold-out marks. The wall shows online orders by their W number.

**Tech Stack:** Hono 4, postgres.js 3, zod 4, vitest 4, PGlite harness (`apps/api/test/pg.ts`), Node 24 + `node:sqlite` (till), React 19, plain Node (wall).

**Spec:** `docs/superpowers/specs/2026-11-20-kennko-backend-design.md`: sections Sync (till ↔ API) › "Online orders in the till" and "Conflicts between the till and admin", Schema › Orders (`prep_status`, `payment_status`), Changes to each app (`apps/pos`, `wall`), Rollout order step 5, Left to the builder (the must-have test "the online-order column allowlist").

### Where this plan sits

Plans 1–4 and "ordering nav/receipts/push" are implemented. The latest migration is `0017_till_sync.sql`, and **this plan adds none**. This is roadmap row 5. It builds on Plan 4's pull (Task 5 left room for `onlineOrders`), on its push engine (`applyPrepStatus` currently answers `flagged online_order` for online orders, Plan 4 Ruling 7), and on its outbox and sold-out replay (Rulings 8 and 14).

**Out of scope:**
- Showing order events and "moved at the till by …" in admin (Plan 6's day report).
- Online orders in the till's History screen, reports or CSV. Those cover till sales only; online sales are reported by the API (Plan 6).
- Printing online tickets.
- Food on the till's sell screen.

## Global Constraints

- Money is integer centavos everywhere; format only at render with `formatPesos()` from `@kennko/core`. Online orders reach the till **without any money fields**.
- Use `type`, never `interface`.
- Imports inside `packages/core` carry `.ts`; relative imports inside `apps/api/src` carry `.js`; `apps/pos` imports carry `.ts`/`.tsx`; the wall stays dependency-free `.mjs` and imports nothing from the apps.
- The API reads time from `deps.now()`, never SQL `now()`, in sync code (the 24-hour window included).
- **A sale is never blocked by the network**, and neither is a prep step: an online step is a local write plus an outbox row. Pulled online orders stay visible offline.
- **The till never cancels or refunds an online order.** Admin does (`POST /v1/orders/:id/cancel`).
- Post-commit side effects (customer push) only through `afterCommit(deps, …)` → `deps.defer`, after the push transaction has committed.
- No new environment variables, no new runtime dependencies, no migration.
- Brand: electric blue `#0055FF`, white, amber accent, no dark styles.
- Run `npm test` and `npm run typecheck` from the repo root before every commit.

## Rulings made while planning (Claude's calls)

1. **Which online orders are pulled:** `channel = 'online' and payment_status = 'paid' and (prep_status <> 'completed' or updated_at >= now − 24 h)`. Unfinished orders come first, then newest first, capped at `ONLINE_PULL_MAX = 200`. `now` is `deps.now()`. A cancelled order is `refunded` or `rejected`, never `paid`, so it drops out of the pull, and the till removes it from its queue and from the wall.
2. **The allowlist:** id, business day, W number, customer name, pickup or delivery, `fulfil_at`, customer note, prep status, created/updated times, and the lines (item name, size code, quantity, option names, ice, line note). For **delivery only**, also address, barangay and phone; a pickup order carries `delivery: null` and no phone. The pull never sends:
   - email, GCash reference, proof path or `order_code` (the code opens the customer's order page);
   - staff note (it can hold reject reasons);
   - map pin, zone or distance;
   - `customer_user_id`;
   - any price or total.

   The SQL selects only `ONLINE_ORDER_COLUMNS` (an exported constant used as identifiers) and the test pins that list.
3. **Conflicts between till and admin resolve by server receive order, and prep moves forward only.** Each change, from admin or the till, is checked against the order's state at the moment the server receives it, using `canMovePrep` from core:
   - a till step that is already the current status → `applied`, reason `already_there`, no change, no push;
   - a step that is not the next one (admin got there first) → `applied`, reason `prep_conflict`, no change, no push;
   - admin's PATCH keeps its own conditional update and `BAD_TRANSITION`/`STATUS_CHANGED` answers.

   So the first change the server receives wins, and the next pull corrects the other side. The till's push still deletes the answered rows, as in Plan 4.
4. **No Back on online tickets.** The customer has already been notified, and admin has no backwards step either. The counter ticket's Back (undo) is unchanged.
5. **The till cannot send a cancel for an online order.** `order.cancelled` on an online order stays `flagged online_order`. `order.prep_status` with `to: 'cancelled'` → `flagged not_from_till`. On an unpaid order → `flagged not_paid`. On a cancelled order → `applied already_cancelled`. The till's UI offers no Void on online tickets.
6. **Notifications:** only a real move notifies, through the same `notifyOrder` and the same status→event map as admin. The map moves from `orders/actions.ts` to `push/notify.ts` as `PREP_PUSH_EVENTS`. The push collects them and runs each with `afterCommit` once `sql.begin` has resolved. Nothing is sent for duplicates, conflicts, held events or a rolled-back savepoint. **There is no email:** admin's prep changes send none (the website emails only on payment confirm/reject), so the till matches admin exactly.
7. **Online orders live in their own SQLite table `online_orders (id text primary key, prep_status text not null, updated_at integer not null, data text not null)`.** `data` holds the pulled JSON. They are never rows in `orders`, so the till's day summary, shift cash, History, CSV and C numbering cannot include them.
8. **Outbox for online steps:** kind `order.prep_status`, entity `'order'`, `entity_local_id` null, payload `{ orderId, to }` with the server's UUID. This is a deliberate exception to Plan 4 Ruling 8: that ruling exists because local rows get their UUID later, but an online order's id is the server's from the start. The outbox schema does not change.
9. **The pull replaces the till's copy, then replays.** In one transaction, `online_orders` is replaced by the pulled list, then each unsent online `order.prep_status` outbox row is re-applied in `seq` order when it is still a valid next step (`canMovePrep`). If the `onlineOrders` key is missing (an API from before this plan), the table is left as it is. A malformed list is answered like any garbled pull, and the table is again left as it is.
10. **Customer phone and address do not stay on a disconnected computer.** `online_orders` is emptied when the till is revoked (`applyDeviceInfo` `revoked`) or forgotten (`/api/device/forget`). Otherwise rows leave when they drop out of the pull.
11. **On the wall:**
    - An online order appears with label `W3` (wall id `5000 + n`) and the customer's **first name only**, since the projector is public.
    - Status mapping: `placed → queued`, `preparing → preparing`, `ready → serving`, `out_for_delivery → done` (the customer is not in the shop, so the number is not called), `completed → done`.
    - `pos-link` orders cats by `createdAt`, then `id`, across both series.
    - A feed without `series` (an older till) is read as counter orders.
12. **No migration:** the pull query is small (a day's online orders), so no index is added.
13. **Admin is unchanged.** It still refuses prep on counter orders (`COUNTER_ORDER`): the till owns counter prep for good. The two code comments that say "until Plan 5" are reworded.

## Review Focus

1. **Privacy of the pull:** no email, GCash reference, proof path, order code, staff note, user id, map pin or money ever leaves the API toward a till, and a pickup order carries no phone. Must-have test in Task 2.
2. **Till and admin moving the same order:** whichever change the server receives first wins; the later one changes nothing and sends no notification; neither side can move an order backwards or skip a step. Tests in Tasks 1 and 3.
3. **Customer notifications:** exactly one push per real move, from the till or admin, sent only after commit; never one for a duplicate, conflict, held event or a rolled-back savepoint; a failing push sender never fails the sync. Test in Task 3.
4. **The till offline:** online orders already pulled stay on the board; steps are recorded and sent in order when back; a pull that arrives before the steps are sent does not undo them on screen. Tests in Tasks 4 and 5.
5. **Till money stays the till's:** online orders never change the till's day summary, shift expected cash, History, CSV or C numbers. Test in Task 4.

---

### Task 1: Online queue contract in core

**Files:**
- Modify: `packages/core/src/sync.ts`, `packages/core/src/sync.test.ts`

**Interfaces:**
- Produces (`@kennko/core`):
  - `ONLINE_PULL_MAX = 200`, `ONLINE_RECENT_MS = 86_400_000`.
  - `type OnlineQueueLine = { name: string; size: string; quantity: number; options: string[]; iceLevel: IceLevel | null; iceServe: IceServe | null; note: string }`.
  - `type OnlineQueueOrder = { id: string; businessDay: string; ticketNumber: number; customerName: string; fulfilment: 'pickup' | 'delivery'; fulfilAt: string; customerNote: string | null; prepStatus: PrepStatus; createdAt: string; updatedAt: string; lines: OnlineQueueLine[]; delivery: { address: string; barangay: string; phone: string } | null }`.
  - `PullState` gains `onlineOrders?: OnlineQueueOrder[]`. Absent means an API from before Plan 5, and the till keeps what it has (Ruling 9).
  - `isOnlineQueueOrder(x: unknown): x is OnlineQueueOrder`, which checks the shape. It requires `delivery !== null` exactly when `fulfilment === 'delivery'`, a uuid `id`, `ticketNumber ≥ 1`, a known `prepStatus`, and string arrays for options.
  - `type OnlinePrepDecision = 'move' | 'same' | 'conflict' | 'cancelled' | 'not_paid' | 'refused'`.
  - `onlinePrepDecision(current: PrepStatus, to: PrepStatus, fulfilment: Fulfilment, paymentStatus: PaymentStatus): OnlinePrepDecision`. The checks run in this order:
    1. `current === 'cancelled'` → `cancelled`;
    2. payment not `paid` → `not_paid`;
    3. `to === 'cancelled'` → `refused`;
    4. `to === current` → `same`;
    5. `canMovePrep(current, to, fulfilment)` → `move`;
    6. otherwise → `conflict`.

- [ ] **Step 1: Write the failing tests** (`sync.test.ts`):

```ts
test('online steps follow the same transitions as admin', () => {
  expect(onlinePrepDecision('placed', 'preparing', 'pickup', 'paid')).toBe('move')
  expect(onlinePrepDecision('preparing', 'ready', 'pickup', 'paid')).toBe('move')
  expect(onlinePrepDecision('preparing', 'out_for_delivery', 'delivery', 'paid')).toBe('move')
  expect(onlinePrepDecision('preparing', 'ready', 'delivery', 'paid')).toBe('conflict')
  expect(onlinePrepDecision('placed', 'ready', 'pickup', 'paid')).toBe('conflict')      // no skipping
  expect(onlinePrepDecision('ready', 'preparing', 'pickup', 'paid')).toBe('conflict')   // no going back
})
test('already there, cancelled, unpaid and cancel requests', () => {
  expect(onlinePrepDecision('ready', 'ready', 'pickup', 'paid')).toBe('same')
  expect(onlinePrepDecision('cancelled', 'preparing', 'pickup', 'refunded')).toBe('cancelled')
  expect(onlinePrepDecision('placed', 'preparing', 'pickup', 'pending_verification')).toBe('not_paid')
  expect(onlinePrepDecision('placed', 'cancelled', 'pickup', 'paid')).toBe('refused')
})
test('isOnlineQueueOrder', () => {
  expect(isOnlineQueueOrder(pickupFixture)).toBe(true)
  expect(isOnlineQueueOrder({ ...pickupFixture, delivery: { address: 'x', barangay: 'y', phone: 'z' } })).toBe(false)
  expect(isOnlineQueueOrder({ ...deliveryFixture, delivery: null })).toBe(false)
  expect(isOnlineQueueOrder({ ...pickupFixture, prepStatus: 'eaten' })).toBe(false)
  expect(isOnlineQueueOrder({ ...pickupFixture, id: 'W3' })).toBe(false)
})
```

- [ ] **Step 2: Run** `npm test -w @kennko/core -- sync` and confirm it FAILS.
- [ ] **Step 3: Implement.** Reuse `canMovePrep`. Import the ice and status types.
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` and confirm they PASS (the optional key keeps the API and the till compiling).
- [ ] **Step 5: Commit** `feat(core): online queue order shape and the shared prep decision`

---

### Task 2: The pull returns paid online orders through an allowlist

**Files:**
- Create: `apps/api/src/sync/online-orders.ts`, `apps/api/test/sync-online-pull.test.ts`
- Modify: `apps/api/src/sync/pull.ts` (signature gains `now: Date`), `apps/api/src/routes/sync.ts` (passes `deps.now()`), `apps/api/test/sync-pull.test.ts` (new argument), `apps/api/README.md` (pull section)

**Interfaces:**
- Produces in `online-orders.ts`:
  - `export const ONLINE_ORDER_COLUMNS = ['id', 'business_day', 'ticket_number', 'customer_name', 'fulfilment', 'fulfil_at', 'customer_note', 'prep_status', 'created_at', 'updated_at', 'customer_phone', 'delivery_address', 'delivery_barangay'] as const`.
  - `ONLINE_LINE_COLUMNS = ['id', 'order_id', 'item_name', 'variant_code', 'variant_label', 'quantity', 'ice_level', 'ice_serve', 'note'] as const`.
  - `ONLINE_OPTION_COLUMNS = ['line_id', 'option_name'] as const`.
  - `readOnlineQueue(sql, now: Date): Promise<OnlineQueueOrder[]>`. It runs three queries, each selecting only its constant via `sql(COLUMNS)` (Ruling 2):
    - orders by Ruling 1, ordered by `(prep_status = 'completed'), created_at desc`, `limit ONLINE_PULL_MAX`, with the cut-off `now − ONLINE_RECENT_MS` bound as a parameter;
    - the lines of those orders;
    - the options of those lines.

    Mapping:
    - `size` is `variant_code ?? variant_label ?? ''`;
    - `options` holds the option names in insert order;
    - `delivery` is built only when `fulfilment = 'delivery'`; otherwise it is null and the phone is dropped;
    - times are ISO strings, `businessDay` is `YYYY-MM-DD`, and `customerNote` is `''` → null.
  - `readPullState(sql, tillVersion, now)` adds `onlineOrders: await readOnlineQueue(sql, now)`.

- [ ] **Step 1: Write `sync-online-pull.test.ts`** (device and published menu from `sync-helpers.ts`, `now` pinned to `2026-11-21T02:00:00Z`). Seed with plain inserts, as `orders-actions.test.ts` `seedOnline` does:
  - **A:** a paid delivery order W1 with:
    - email `ana.secret@x.test`, order code `KNK-SECRET`, staff note `internal-note`, `customer_user_id` U;
    - `delivery_lat` 8.947, `delivery_address` `'1 Gate St'`, barangay `Libertad`, phone `09171112222`;
    - customer note `'No straw'`;
    - a payment with reference `GC-REF-998877` and proof path `proofs/ana-receipt.jpg`;
    - one line `Latte`, M, ×2, with option `Oat milk`.
  - **B:** a paid pickup order W2 with phone `09170000001`.
  - **C:** a `pending_verification` order W3.
  - **D:** a rejected and cancelled order W4.
  - **E:** a paid `completed` order W5 updated 2 h before `now`.
  - **F:** a paid `completed` order W6 updated 25 h before `now`.
  - **G:** a counter order.

  The tests:
  - `GET /v1/sync/pull` → `onlineOrders` ids are exactly [A, B, E], with the unfinished ones first.
  - **Allowlist (must-have, Review Focus 1):**
    - every order's `Object.keys(...).sort()` equals `['businessDay','createdAt','customerName','customerNote','delivery','fulfilAt','fulfilment','id','lines','prepStatus','ticketNumber','updatedAt']`;
    - every line's keys equal `['iceLevel','iceServe','name','note','options','quantity','size']`;
    - A's `delivery` keys equal `['address','barangay','phone']` with the seeded values; B's `delivery` is `null`;
    - `JSON.stringify(body)` contains none of `ana.secret@x.test`, `GC-REF-998877`, `proofs/ana-receipt.jpg`, `KNK-SECRET`, `internal-note`, `09170000001`, U or `8.947`;
    - a deep walk over every key in the body finds none matching `/centavos|price|total|email|reference|proof|code$|user/i` (`variant_code` is never exposed as a key: `size` carries it);
    - `ONLINE_ORDER_COLUMNS`, `ONLINE_LINE_COLUMNS` and `ONLINE_OPTION_COLUMNS` deep-equal the literal lists above, so adding a column means changing this test.
  - A's line is `{ name: 'Latte', size: 'M', quantity: 2, options: ['Oat milk'], … }` and `customerNote` is `'No straw'`.
  - Setting E's `updated_at` to 23 h 59 m before `now` keeps it; moving `now` forward 2 h drops it (the window uses `deps.now()`).
  - 201 unfinished paid orders → 200 returned, none of them completed.
  - Revoked device → 401.
- [ ] **Step 2: Run** `npm test -w @kennko/api -- sync-online-pull` and confirm it FAILS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` and confirm they PASS.
- [ ] **Step 5: Commit** `feat(api): pull returns paid online orders through a column allowlist`

---

### Task 3: Online prep steps through push, with the customer's notification

**Files:**
- Create: `apps/api/test/sync-online-prep.test.ts`
- Modify:
  - `apps/api/src/sync/apply.ts`: `Applied` gains `notify?: { orderId: string; event: OrderPushEvent }`;
  - `apps/api/src/sync/counter-order.ts`: the online branch of `applyPrepStatus`; the `loadOrder` select adds `fulfilment, payment_status`;
  - `apps/api/src/sync/push.ts`: collects and defers notifications;
  - `apps/api/src/push/notify.ts`: `PREP_PUSH_EVENTS`;
  - `apps/api/src/orders/actions.ts`: uses `PREP_PUSH_EVENTS` and rewords the counter comment (Ruling 13);
  - `apps/api/test/sync-helpers.ts`: `syncApp(sql, start, opts?: { push?: PushSender })`.

**Interfaces:**
- Consumes: Task 1 `onlinePrepDecision`; `notifyOrder`, `afterCommit`.
- Produces:
  - `notify.ts`: `export const PREP_PUSH_EVENTS: Partial<Record<PrepStatus, OrderPushEvent>> = { preparing: 'preparing', ready: 'ready', out_for_delivery: 'out_for_delivery', completed: 'completed' }`.
  - `applyPrepStatus`, online orders (Rulings 3, 5, 6). The decision from `onlinePrepDecision(order.prep_status, to, order.fulfilment, order.payment_status)` maps as follows:
    - `cancelled` → `applied('already_cancelled')`;
    - `not_paid` → `flagged('not_paid')`;
    - `refused` → `flagged('not_from_till')`;
    - `same` → `applied('already_there')`;
    - `conflict` → `applied('prep_conflict')`;
    - `move` → `update orders set prep_status = to, updated_at = now where id and prep_status = <current>`, then an `order_events` row (id = event id, `device_id`, kind `prep_status`, from/to, `staff_id`, `occurred_at`, `received_at`), then `{ ...applied(), notify: { orderId, event: PREP_PUSH_EVENTS[to] } }`.

    The order stays locked `for update`, as today. The counter branch is unchanged.
  - `push.ts`: `retryHeld` and the new-event loop push `out.notify` into a local `notes` array, but only from the final `Applied` of an event whose receipt was written. The `invalid: receipt` fallback carries none. After `deps.sql.begin(...)` resolves, `for (const n of notes) await afterCommit(deps, () => notifyOrder(deps, n.orderId, n.event))`. A retryable error that throws out of `begin` sends nothing. `PushResponse` is unchanged.

- [ ] **Step 1: Write `sync-online-prep.test.ts`.** Setup:
  - a fake `PushSender` records `{ endpoint, payload }`, and `syncApp(sql, now, { push: sender })`;
  - staff Bea, plus an owner for direct `patchOrder(deps, …)` calls, imported from `orders/actions.ts`;
  - helpers `seedPaidOnline(fulfilment)`, which inserts the order with `payment_status 'paid'` and a `verified` payment, then a `push_subscriptions` row and a `push_order_watch` row for it.

  The tests:
  - pickup W5: push `prepStatus({ orderId, to: 'preparing' }, { staffId: bea })` → `applied`, reason null; the order is `preparing`; one `order_events` row with `device_id`, `staff_id` = Bea and `from_value 'placed'`; one push with title `W5 is being prepared`. Then `ready`, then `completed` in one push → both applied, 3 pushes in total (`… is ready for pickup`, `… is complete — enjoy!`).
  - delivery: `preparing` → `out_for_delivery` → `completed` all applied, with `… is on its way` sent. A `to: 'ready'` from `preparing` → `applied` `prep_conflict`, still `preparing`, no push.
  - **Review Focus 2, admin first:** `patchOrder` to `preparing` (ok, 1 push), then a till step to `preparing` → `applied` `already_there`, one `order_events` row in total, still 1 push. A till step to `ready` → moves, 2 pushes.
  - **Review Focus 2, till first:** a till step to `preparing`; `patchOrder` to `preparing` → `{ ok: false, code: 'BAD_TRANSITION' }`; `patchOrder` to `ready` → ok.
  - **Review Focus 2, stale till step:** admin moves the order to `ready`; a till step to `preparing` received later → `applied` `prep_conflict`, still `ready`, no new push; a till step to `placed` → `prep_conflict`.
  - **Review Focus 3:**
    - the same push sent twice → second `duplicate`, push count unchanged;
    - a sender that throws → the push still answers 200 `applied` and the order still moves;
    - an event with payload `to: 'bogus'` for order X → held `invalid: …`; a valid step for X behind it → held `waits_for_earlier`; no push and no change;
    - `order.prep_status` for an online order that is not in the database yet → held `order_unknown`, no push.
  - **Ruling 5:**
    - `orderCancelled({ orderId })` on a paid online order → `flagged` `online_order`, still `placed`/`paid`;
    - `to: 'cancelled'` → `flagged` `not_from_till`;
    - a `pending_verification` online order → `flagged` `not_paid`;
    - an order admin cancelled → `applied` `already_cancelled`.
  - Counter prep (Plan 4) is unaffected: a counter order still moves with no push and no `notify`.
- [ ] **Step 2: Run** `npm test -w @kennko/api -- sync-online-prep` and confirm it FAILS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** root `npm test` (including `sync-orders`, `orders-actions` and `push`) + `npm run typecheck` and confirm they PASS.
- [ ] **Step 5: Commit** `feat(api): till moves online orders through prep, customer notified as from admin`

---

### Task 4: Till store — `online_orders`, steps into the outbox, replay

**Files:**
- Create: `apps/pos/test/online-orders.test.ts`
- Modify: `apps/pos/server/store.ts`

**Interfaces:**
- Produces in `store.ts`:
  - The schema adds `create table if not exists online_orders (id text primary key, prep_status text not null, updated_at integer not null, data text not null)` (Ruling 7).
  - `onlineOrders(): OnlineQueueOrder[]` returns every row, with `prepStatus` taken from the column, ordered by `createdAt`.
  - `activeOnlineOrders(): OnlineQueueOrder[]` returns the rows in `placed`, `preparing`, `ready` or `out_for_delivery`.
  - `recentlyFinishedOnline(since: number): OnlineQueueOrder[]` returns the `completed` rows with `updated_at >= since`.
  - `replaceOnlineOrders(orders: OnlineQueueOrder[]): void` runs as one `tx` (Ruling 9):
    1. delete all rows;
    2. insert the pulled orders (`updated_at = Date.parse(updatedAt)`);
    3. for each outbox row with kind `order.prep_status` and a payload `orderId`, in `seq` order: when the row exists and `canMovePrep(current, to, fulfilment)`, set `prep_status = to` and `updated_at = occurred_at`.
  - `advanceOnline(id: string, now: number, by: By): OnlineQueueOrder` runs as one `tx`:
    - a missing row → `OrderError('That online order is no longer on the till.')`;
    - `next = nextPrepStatus(prep, fulfilment)`, and null → `OrderError('That order is already finished.')`;
    - update the row, then `record('order.prep_status', null, checkBy(by), now, { orderId: id, to: next })` (Ruling 8);
    - return the updated order.
  - `clearOnlineOrders(): void`.
  - `StoredPayload<'order.prep_status'>` becomes `{ to } | { orderId: string; to }`. In `toEvent`, a stored `orderId` string is used as is; otherwise the order's `uid`, as today.

- [ ] **Step 1: Write `online-orders.test.ts`** (`createStore(':memory:')`, fixtures built with `isOnlineQueueOrder`-valid pickup and delivery orders):
  - `replaceOnlineOrders([pickup, delivery])` → `onlineOrders()` returns both by `createdAt`; replacing with `[delivery]` removes the pickup.
  - `advanceOnline` on pickup: `placed → preparing → ready → completed`, then `already finished`. On delivery: `preparing → out_for_delivery → completed`.
  - Each step adds exactly one outbox row (`entity 'order'`, `entity_local_id` null, `staff_id` = `by`). `outboxEvents()` yields `{ kind: 'order.prep_status', payload: { orderId: <the uuid>, to } }` in order. A failing step (unknown id, finished order) leaves the outbox unchanged.
  - **Review Focus 4:** advance pickup to `preparing` (unsent), then `replaceOnlineOrders` with the server copy still `placed` → shows `preparing`. After `ackOutbox` of that row, a pull saying `placed` → `placed`. An unsent `preparing` step when the server says `ready` → stays `ready` (not a valid step, so it is not replayed). An unsent step for an order no longer pulled → nothing is inserted.
  - `activeOnlineOrders` excludes `completed`; `recentlyFinishedOnline(now − 90_000)` includes an order completed at `now`.
  - **Review Focus 5:** with an open shift, a counter sale, a pulled online order advanced to `completed`: `daySummary(today)`, `shiftSummary(openShift())`, `ordersForDay(today)` and `activeOrders()` are identical to a store without the online order; the next counter sale is still `#2`.
  - `clearOnlineOrders()` empties the table and leaves the outbox alone.
  - The Plan 4 tests still pass, including the counter `order.prep_status` mapping through `uid`.
- [ ] **Step 2: Run** `npm test -w @kennko/pos` and confirm it FAILS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` and confirm they PASS.
- [ ] **Step 5: Commit** `feat(pos): online orders kept apart, prep steps into the outbox, replayed over pulls`

---

### Task 5: Till sync and server — pull them in, serve them, step them, feed the wall

**Files:**
- Create: `apps/pos/test/wall-feed.test.ts`
- Modify:
  - `apps/pos/server/sync.ts`: the `onlineOrders` step in the pull; `SyncChange` gains `online`;
  - `apps/pos/server/device.ts`: `applyDeviceInfo` `revoked` → `store.clearOnlineOrders()`;
  - `apps/pos/server/wall-feed.ts`;
  - `apps/pos/server/index.ts`;
  - `apps/pos/test/sync.test.ts`, `apps/pos/test/device.test.ts`.

**Interfaces:**
- Produces:
  - `sync.ts`:
    - `isPullState` also requires `onlineOrders` to be absent or an array whose every element passes `isOnlineQueueOrder`. Anything else is GARBLED: the run fails as in Plan 4 and the table is untouched.
    - On a good pull with the key present: `before = JSON.stringify(store.onlineOrders())`, then `store.replaceOnlineOrders(state.onlineOrders)`, then `changed.online` is true when the JSON differs.
    - Without the key, nothing is touched.
  - `wall-feed.ts`:
    - `WallOrder` gains `series: 'C' | 'W'`, and `wallOrders` sets `'C'`.
    - `wallOnlineOrders(orders: OnlineQueueOrder[]): WallOrder[]` maps each order to `{ id: ticketNumber, number: ticketNumber, series: 'W', name: <first word of customerName>, items: <aggregated by line name>, status: ONLINE_TO_WALL[prepStatus], createdAt: Date.parse(createdAt), updatedAt: Date.parse(updatedAt) }`.
    - `ONLINE_TO_WALL: Record<PrepStatus, OrderStatus>` is `placed→queued, preparing→preparing, ready→serving, out_for_delivery→done, completed→done, cancelled→voided` (Ruling 11).
  - `index.ts`:
    - The live `snapshot()` adds `online: store.activeOnlineOrders()`.
    - `wallSnapshot()` concatenates `wallOnlineOrders([...store.activeOnlineOrders(), ...store.recentlyFinishedOnline(now − WALL_LINGER_MS)])`.
    - New route `POST /api/online/:id/advance` (`id` must match the uuid pattern, else 404) → `done(store.advanceOnline(id, now, by))`, which needs a session like counter advance.
    - `/api/device/forget` also calls `store.clearOnlineOrders()` (Ruling 10).
    - The startup log's Sync line adds `, N online orders in the queue` when there are any.

- [ ] **Step 1: Write the failing tests:**
  - `sync.test.ts`:
    - a pull with `onlineOrders: [W5 placed]` → `store.onlineOrders()` has it and `onChange` gets `online: true`; the same pull again → `online: false`.
    - **Review Focus 4:**
      1. `store.advanceOnline(W5)` while push answers 503;
      2. the pull still says `placed` → the store shows `preparing`;
      3. the next run's push body contains `{ kind: 'order.prep_status', payload: { orderId: W5.id, to: 'preparing' } }` before any later event.
    - A pull without `onlineOrders` → the table is untouched. A pull with `onlineOrders: [{ id: 'x' }]` → `problem` set, the table is untouched.
    - A pull no longer listing W5 → removed.
    - 401 `DEVICE_REVOKED` → `store.onlineOrders()` is empty.
  - `device.test.ts`: `applyDeviceInfo(…, { status: 'revoked' })` clears online orders.
  - `wall-feed.test.ts`:
    - `wallOnlineOrders` maps each prep status per Ruling 11;
    - the name `'Ana Dela Cruz'` becomes `'Ana'`;
    - two `Latte` lines of different sizes become `{ name: 'Latte', qty: 3 }`;
    - `series: 'W'`;
    - the result has no `delivery`, `phone`, `customerNote` or `lines` key.
- [ ] **Step 2: Run** `npm test -w @kennko/pos` and confirm it FAILS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` + `npm run build -w @kennko/pos` and confirm they PASS.
- [ ] **Step 5: Commit** `feat(pos): online orders pulled into the till, stepped from it, fed to the wall`

---

### Task 6: Till screen — online tickets on the Orders board

**Files:**
- Create: `apps/pos/src/onlineText.ts`, `apps/pos/test/onlineText.test.ts`
- Modify: `apps/pos/src/api.ts`, `apps/pos/src/screens/Orders.tsx`, `apps/pos/src/App.tsx` (rail badge), `apps/pos/src/styles.css`, `apps/pos/README.md`

**Interfaces:**
- Produces:
  - `onlineText.ts`:
    - `onlineColumn(p: PrepStatus): 'queued' | 'preparing' | 'serving' | null` maps `placed→queued`, `preparing→preparing`, `ready` and `out_for_delivery→serving`, and anything else to null.
    - `onlineAction(p, fulfilment): string | null` gives `placed→'Start'`; `preparing→'Ready'` (pickup) or `'Out for delivery'` (delivery); `ready→'Picked up'`; `out_for_delivery→'Delivered'`.
    - `onlineStage(p, fulfilment): string` is the pill text: `'Ready for pickup'` or `'Out for delivery'` in the serving column, else `''`.
    - `onlineWhen(o, now): string` gives `'Pickup 3:30 PM'` or `'Delivery 3:30 PM'` in Manila time, with `'Sat 22 Nov, '` before the time when `fulfilAt` is not on `manilaDay(now)`.
    - `deliveryText(o): string | null` gives `'1 Gate St, Libertad · 0917 111 2222'`, or null for pickup.
  - `api.ts`: `Live` gains `online: OnlineQueueOrder[]`; `advanceOnline: (id: string) => call<OnlineQueueOrder>('POST', `/api/online/${id}/advance`, {})`.
  - `Orders.tsx`: each column renders counter and online tickets together, sorted by creation time.
    - An online ticket (`ticket ticket-online`) shows:
      - header: `W{n}`, customer name, an amber `Online` pill;
      - `onlineWhen`, and `onlineStage` when set;
      - the lines, as counter tickets show them, with options, ice and note;
      - `customerNote` in italics when set;
      - `deliveryText` when delivery;
      - the footer: waited time and one primary button with `onlineAction`, which calls `api.advanceOnline`.
    - An online ticket has no Back and no Void (Rulings 4 and 5).
    - `busy` becomes `string | null` (`c:<id>` / `w:<id>`).
  - `App.tsx`: the Orders badge counts `live.active.length + live.online.length`.
  - README: a section "Online orders" covering:
    - only paid orders arrive, within about 15 s;
    - the buttons and what the customer is told at each step;
    - no Back, and cancel and refund are done in admin;
    - offline behaviour;
    - online orders are not in History, reports or the cash count;
    - phone and address are deleted when the till is disconnected.

- [ ] **Step 1: Write `onlineText.test.ts`:**
  - every prep status × fulfilment for `onlineColumn`, `onlineAction` and `onlineStage`;
  - `onlineWhen` for today (`'Pickup 3:30 PM'`), for tomorrow with a date, and across Manila midnight (a UTC `fulfilAt` of `2026-11-21T16:30:00Z` is `Sun 22 Nov, 12:30 AM`);
  - `deliveryText` for delivery and pickup.
- [ ] **Step 2: Run** `npm test -w @kennko/pos -- onlineText` and confirm it FAILS.
- [ ] **Step 3: Implement.** `ticket-online` gets a 6 px amber left border and the W number in blue `#0055FF`; no dark styles.
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` + `npm run build -w @kennko/pos` and confirm they PASS. Manual check with `npm run pos`: insert a pulled order by hand through a tiny script calling `store.replaceOnlineOrders`, or run against a local API, and step it to completed. Check at 768 and 1024 px that a delivery ticket's address wraps inside the card.
- [ ] **Step 5: Commit** `feat(pos): online orders on the Orders board with W numbers and forward-only steps`

---

### Task 7: Wall — W numbers from the till's feed

**Files:**
- Modify: `wall/pos-link.mjs`, `wall/public/wall.mjs`, `wall/test/pos-link.test.mjs`, `wall/README.md`

**Interfaces:**
- Produces:
  - `fromPosFeed`:
    - Each order's `series` is `'W'` or else `'C'`, so an older till without the field still works.
    - Orders are sorted by `createdAt`, then `id`.
    - The wall id is `o.number` for C and `5000 + o.number` for W; the existing `+1000` loop on clashes applies to both.
    - W orders carry `label: 'W' + o.number`; C orders carry no label.
    - All other validation is unchanged.
  - `wall.mjs`: the banner number, the board rows and the queue chips show `order.label ?? String(order.id)`. The banner reads "Order W3 for Ana is ready!".
  - README "Following the till": online orders appear with their W number and first name; delivery orders leave when they go out for delivery; cancelled online orders are taken off.

- [ ] **Step 1: Write the failing tests** (`pos-link.test.mjs`):
  - a feed with `C3` (`{ id: 7, number: 3 }`, no series) and `W3` (`series: 'W', number: 3`) → wall ids `3` and `5003`; label undefined for the first and `'W3'` for the second;
  - two `W1`s across midnight → `5001` and `6001`;
  - a W order created before a C order sorts first;
  - the existing tests still pass.
- [ ] **Step 2: Run** `node --test wall/test` (or the wall's `npm test` script) and confirm it FAILS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` and confirm they PASS. Manual check: `npm run wall:pos` with a till holding one counter and one online order shows `3` and `W1`, and stepping W1 to ready rings the bell with "W1".
- [ ] **Step 5: Commit** `feat(wall): online orders on the wall with their W number`

---

### Task 8: Deploy checklist

**Files:** `apps/api/README.md` (a "Plan 5" section with the steps below). Nothing is run by the implementer: Julius deploys.

- [ ] **Step 1:** On the branch tip, run root `npm test`, `npm run typecheck`, `KENNKO_API_URL= npm run build -w @kennko/web`, `npm run build -w @kennko/api` (load `server.js` with dummy env, as in earlier plans) and `npm run build -w @kennko/pos`.
- [ ] **Step 2: Write the checklist** into the README, in this order:
  1. **Migration:** none in this plan. Confirm the dry run lists nothing new after 0017.
  2. **API** deploy. No new environment variables. An old till ignores the new `onlineOrders` key. Smoke checks: `/health` 200; `GET /v1/sync/pull` without a token → 401.
  3. **Website:** no change.
  4. **Till** (shop computer): pull, `npm run pos:build`, restart. The startup log's Sync line shows the online count once an order is waiting.
  5. **Wall:** pull and restart `npm run wall:pos`.
  6. **Live checks:**
     - Place a ₱ test online pickup order on the website and verify its payment in admin → within 15 s it appears on the till's Orders board as `W<n>` with an Online pill, and on the wall with the first name.
     - Tap **Start** on the till → the phone that placed the order gets "W<n> is being prepared", and admin shows Preparing after a refresh.
     - Move it to Ready in admin → the till follows within 15 s, and the till's button now reads **Picked up**.
     - Pull the shop computer's network cable and tap **Picked up** → the ticket leaves the board and the badge shows "Offline: changes waiting to send". Reconnect → the badge clears, admin shows Completed, and the customer got exactly one "complete" notification.
     - A delivery test order shows address, barangay and phone on the ticket, and **Out for delivery** sends "is on its way".
     - Cancel an online order in admin → it leaves the till and the wall within 15 s.
     - Disconnect the till in admin → its online tickets disappear.
- [ ] **Step 3: Commit** `docs(api): plan 5 deploy checklist`

## Self-review notes

- **Spec coverage for roadmap row 5:**
  - the pull returns paid online orders that are unfinished or updated in the last 24 h ✔ (1, 2);
  - the explicit column allowlist with a test (must-have) ✔ (2): name, W number, items, pickup or delivery, time and note; for delivery also address, barangay and phone; never email, GCash reference or receipt;
  - shown in the till queue alongside counter orders ✔ (5, 6), and on the wall, which shows counter orders today ✔ (5, 7);
  - the till moves online orders `preparing → ready / out_for_delivery → completed` through push events applied in receive order, with admin's transitions ✔ (1, 3, 4);
  - the same customer notifications via `deps.defer` ✔ (3); there are no prep emails on either side (Ruling 6);
  - conflicts resolve by server receive order ✔ (3, Ruling 3);
  - the till never cancels or refunds ✔ (3, 6, Ruling 5);
  - offline-first: pulled orders stay visible, and steps go into the outbox and survive pulls ✔ (4, 5).
- **Every app keeps working when deployed alone, in order:**
  - the API first: old tills ignore `onlineOrders`, and admin is unchanged;
  - the till next: against an old API the key is absent and the table stays empty;
  - the wall last: an old wall given the new feed still validates W orders (integer `id`/`number`), and only the label is missing.
- **Known limits:**
  - An online step made offline and sent much later may notify the customer late.
  - A step admin overtook is answered `prep_conflict` and corrected by the next pull: the barista sees the ticket jump within 15 s.
  - The wall's queue chips list C numbers before W numbers when their ids sort that way.
- **Deferred:** admin's view of order events and till attribution (Plan 6); online orders in the till's History and reports; printing online tickets.
