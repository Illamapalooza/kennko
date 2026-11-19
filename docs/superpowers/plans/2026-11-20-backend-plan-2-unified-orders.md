# Backend Plan 2: Unified Orders Through the API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn today's online-only orders into the spec's one order record (prep and payment split, payments table, W ticket numbers, event history), and move online checkout and every admin order write from the website into `apps/api`.

**Architecture:** The pure rules (checkout validation, delivery fee, pricing against a snapshot, the prep/payment vocabulary) move into `packages/core` so the API and later the till share them. One migration reshapes the order tables in place and backfills the existing rows. The API gains `POST /v1/orders` (one transaction: ticket, order, lines, options, payment, event) and the staff actions; the website keeps its `/api/orders` route as a thin proxy (same-origin, rate limit, staff alert email) and its admin actions call the API with the staff's token. Website reads stay on Supabase but use the new columns.

**Tech Stack:** Hono 4, postgres.js 3, zod 4, jose 6, vitest 4, PGlite harness (`apps/api/test/pg.ts`), Supabase Storage REST, Next.js 16.

**Spec:** `docs/superpowers/specs/2026-11-20-kennko-backend-design.md` — sections Schema › Orders, Architecture, API, Migration notes, Rollout order step 3. Current-state map used to write this plan: every claim about today's code below was checked against the repo on 2026-11-20.

### Where this plan sits

Plan 1 (menu, snapshots, API skeleton) and the admin redesign are merged to `main`. This is roadmap row 2. Counter orders, devices, shifts and sync are Plans 3–4: this plan adds **no** `device_id`, `shift_id` or `opened_by_staff` columns (their tables do not exist yet); Plan 4 adds them.

## Global Constraints

- Money is integer centavos everywhere; format only at render with `formatPesos()` from `@kennko/core`.
- Use `type`, never `interface`.
- Imports inside `packages/core` carry the `.ts` extension; relative imports inside `apps/api/src` carry `.js` (Vercel does not rewrite `.ts`).
- Text + `check` for every new status or kind column; no new Postgres enums. Existing `ice_level`/`ice_serve` enums stay.
- Every new table has RLS enabled; `anon` and `authenticated` get only the policies this plan lists.
- The API's database access is role `kennko_api` only. The Supabase service-role key is used by the API **only** inside `apps/api/src/storage.ts` for payment-proof files, never for SQL.
- The website must not write `orders`, `order_lines`, `order_line_options`, `payments` or `order_events` after this plan (spec, Architecture). It may still read them with its service key.
- Manila business day: `manilaDay(ms)` from `@kennko/core` (UTC+8, fixed in code).
- Statuses (exact strings): prep `placed | preparing | ready | out_for_delivery | completed | cancelled`; payment `unpaid | pending_verification | paid | rejected | refunded`; payment row `recorded | pending_verification | verified | rejected | refunded`.
- API error bodies on order routes: `{ code: string, message: string, errors: string[] }` (the website shows `errors`).
- Run `npm test` and `npm run typecheck` from the repo root before every commit.

## Rulings made while planning (Claude's calls)

1. **Coordinated switch, no compatibility views.** The order data is test data and only the team orders today, so migration 0014 reshapes the tables in place and the new API + website deploy right after it. Cost if wrong: a few minutes where the old website's order pages error (Task 8 orders the steps to keep that window short).
2. **Proof upload happens in the API** with the service-role key confined to `storage.ts` (spec: `POST /v1/orders` includes the proof upload; the website drops its key later, so the API is the eventual holder).
3. **The website keeps `/api/orders` as a proxy** so the browser stays same-origin (no CORS), the in-memory rate limit stays, and the staff alert email keeps sending from the website. Emails stay in the website for this plan; the API holds no Resend key.
4. **Signed-in customers are linked by the API**, not by the body: the proxy forwards the customer's Supabase access token; an invalid or expired token makes the order a guest order (history still matches by confirmed email), never a refused checkout.
5. **New order codes are `KNK-` + 6 characters** from the existing alphabet, with up to 3 retries on a collision. Existing 4-character codes keep working.
6. **Cancel is owner-only** and online-only (spec: admin cancels online orders only). Verify, reject and prep changes stay open to any active staff, as today.
7. **Food stays off online checkout** (`SELLABLE_CODES` unchanged); lines now store `variant_code` as text so a later plan can sell `REG` without a migration.
8. **The website's eight-word status vocabulary survives as a derived "stage"** (`orderStage(prep, payment)`), so labels, tabs, CSS classes and copy keep working while the columns change underneath.

## Review Focus

1. **A checkout that fails half-way** (proof uploaded, then the database insert fails): no order rows remain and the uploaded proof is removed. Test in Task 4.
2. **Two staff press "Confirm payment" at once, or confirm after another staff rejected:** exactly one wins; the other gets 409 `STATUS_CHANGED` and nothing is written twice. Test in Task 5.
3. **A tampered admin call** (prep jump `placed → completed`, prep change on an unpaid order, a barista cancelling, cancelling a completed order): refused with 409 or 403, no write. Test in Task 5.
4. **Existing orders survive the migration** with the right prep/payment pair for each of the eight old statuses, a payment row each, W numbers per Manila day in creation order, and customers still able to read their own history. Test in Task 3.
5. **A signed-in customer with an expired token checks out:** the order is created as a guest order, not refused. Test in Task 4.

---

### Task 1: Order vocabulary in core

**Files:**
- Create: `packages/core/src/order-status.ts`, `packages/core/src/order-status.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `type Channel = 'counter' | 'online'`, `type Fulfilment = 'dine_in' | 'takeout' | 'pickup' | 'delivery'`
  - `type PrepStatus`, `type PaymentStatus`, `type PaymentRowStatus` (strings in Global Constraints)
  - `type OrderStage = 'awaiting_verification' | 'confirmed' | 'preparing' | 'ready' | 'out_for_delivery' | 'completed' | 'rejected' | 'cancelled'`
  - `orderStage(prep: PrepStatus, payment: PaymentStatus): OrderStage`
  - `nextPrepStatus(prep: PrepStatus, fulfilment: Fulfilment): PrepStatus | null`
  - `canMovePrep(from: PrepStatus, to: PrepStatus, fulfilment: Fulfilment): boolean` (true only for `to === nextPrepStatus(from, fulfilment)`)
  - `ticketLabel(series: 'C' | 'W', n: number): string` → `"W12"`

- [ ] **Step 1: Write the failing tests** (`order-status.test.ts`)

```ts
test('orderStage maps every prep/payment pair the website shows', () => {
  expect(orderStage('placed', 'pending_verification')).toBe('awaiting_verification')
  expect(orderStage('placed', 'paid')).toBe('confirmed')
  expect(orderStage('preparing', 'paid')).toBe('preparing')
  expect(orderStage('ready', 'paid')).toBe('ready')
  expect(orderStage('out_for_delivery', 'paid')).toBe('out_for_delivery')
  expect(orderStage('completed', 'paid')).toBe('completed')
  expect(orderStage('cancelled', 'rejected')).toBe('rejected')
  expect(orderStage('cancelled', 'refunded')).toBe('cancelled')
  expect(orderStage('cancelled', 'paid')).toBe('cancelled')
})
test('pickup and delivery flows', () => {
  expect(nextPrepStatus('placed', 'pickup')).toBe('preparing')
  expect(nextPrepStatus('preparing', 'pickup')).toBe('ready')
  expect(nextPrepStatus('preparing', 'delivery')).toBe('out_for_delivery')
  expect(nextPrepStatus('ready', 'pickup')).toBe('completed')
  expect(nextPrepStatus('out_for_delivery', 'delivery')).toBe('completed')
  expect(nextPrepStatus('completed', 'pickup')).toBeNull()
  expect(nextPrepStatus('cancelled', 'delivery')).toBeNull()
  expect(canMovePrep('placed', 'completed', 'pickup')).toBe(false)
  expect(canMovePrep('preparing', 'ready', 'delivery')).toBe(false)
})
test('ticket label', () => expect(ticketLabel('W', 12)).toBe('W12'))
```

Counter flows (`dine_in`/`takeout`: `placed → preparing → ready → completed`) get one assertion each.

- [ ] **Step 2: Run** `npm test -w @kennko/core` — FAIL (module missing).
- [ ] **Step 3: Implement** the types and functions; export from `index.ts`. Do not touch the till's `OrderStatus` in `order.ts` (different vocabulary; Plan 4 maps it).
- [ ] **Step 4: Run** root `npm test` and `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(core): order prep/payment vocabulary and ticket labels`

---

### Task 2: Checkout rules move to core

**Files:**
- Create: `packages/core/src/checkout.ts`, `packages/core/src/delivery.ts`, `packages/core/src/price-order.ts` and a `.test.ts` beside each
- Delete: `apps/web/lib/orders/validate.ts`, `apps/web/lib/delivery/distance.ts`, `apps/web/lib/delivery/verify.ts`, `apps/web/lib/orders/price-from-snapshot.ts` and their tests (moved, not rewritten)
- Modify: every website import of those modules (`grep -rn "lib/delivery\|orders/validate\|price-from-snapshot" apps/web`) to import from `@kennko/core`; `packages/core/src/index.ts`

**Interfaces:**
- Produces (bodies and tests move as they are today; only names below are new):
  - `checkout.ts`: `type CheckoutInput`, `type CheckoutLine`, `validateCheckout(input, now): string[]` (today's `apps/web/lib/orders/validate.ts`, same messages)
  - `delivery.ts`: `LatLng`, `CAFE_ORIGIN`, `haversineKm`, `ridingDistanceKm`, `deliveryFeeCentavos`, `verifyPin`, `MAX_PIN_DRIFT_KM`, `MAX_ACCURACY_M`, `PinCheck` (today's two files merged)
  - `price-order.ts`: `SELLABLE_CODES`, `priceLineFromSnapshot(snapshot, line)` (today's, unchanged behaviour and error codes `ITEM_UNAVAILABLE | SIZE_UNAVAILABLE | MODIFIER_UNAVAILABLE`), plus the new
    `priceOnlineOrder(snapshot: MenuSnapshot, lines: CheckoutLine[]): PricedOnlineOrder` where
    `type PricedOnlineOrder = { lines: PricedOnlineLine[]; subtotalCentavos: number }` and
    `type PricedOnlineLine = { itemId: string; variantId: string; variantCode: string; variantLabel: string; itemName: string; unitPriceCentavos: number; quantity: number; lineTotalCentavos: number; iceLevel: IceLevel | null; iceServe: IceServe | null; note: string | null; options: { optionId: string; groupName: string; optionName: string; priceCentavos: number }[] }`.
    It throws `OrderError` with code `BAD_QUANTITY` for quantity outside 1–20 and `EMPTY_CART` for no lines; ice goes through `normaliseIce`; notes are trimmed and cut to `NOTE_MAX`.

- [ ] **Step 1: Move the four modules and their tests** into core with `git mv`, fix imports to `.ts`, run `npm test -w @kennko/core` — the moved tests PASS unchanged.
- [ ] **Step 2: Write the failing tests for `priceOnlineOrder`**: a two-line order returns the snapshot's variant id/label, option group names and `subtotalCentavos` equal to the sum of `lineTotal`s; an `M` line on an item whose `M` variant is sold out throws `SIZE_UNAVAILABLE`; quantity 21 throws `BAD_QUANTITY`; an iced drink with `iceLevel: 'none'` comes back with `iceServe: null`.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement** `priceOnlineOrder` on top of `priceLineFromSnapshot`.
- [ ] **Step 5: Point the website at core**: update imports; `apps/web/lib/orders/create.ts` keeps working for now (Task 6 deletes it). Root `npm test` + `npm run typecheck` PASS.
- [ ] **Step 6: Commit** `refactor(core): checkout validation, delivery fee and order pricing live in core`

---

### Task 3: Migration 0014 — one order record

**Files:**
- Create: `apps/api/supabase/migrations/0014_unified_orders.sql`, `apps/api/test/orders-schema.test.ts`

**Interfaces:**
- Produces the schema every later task uses. Names are exact.

Shape (one migration, one transaction; existing names on the left are today's):

| Today | After 0014 |
|---|---|
| `orders.status order_status` | dropped after backfill into `prep_status text`, `payment_status text` (checks per Global Constraints); `order_status` type dropped; `orders_status_created_idx` → `orders_prep_created_idx (prep_status, created_at desc)` and `orders_payment_idx (payment_status)` |
| `orders.fulfilment fulfilment_method` | `fulfilment text` with check `orders_channel_fulfilment` (spec's channel/fulfilment check); type `fulfilment_method` dropped |
| — | `channel text not null default 'online'`, `business_day date not null`, `ticket_series text not null check (ticket_series in ('C','W'))` with `check ((channel='online') = (ticket_series='W'))`, `ticket_number int not null check (> 0)`, `menu_version bigint references menu_snapshots(version)`, `discount_centavos int not null default 0 check (>= 0)`, `discount_label text`, `discount_kind text check (in ('percent','amount'))`, `discount_value int`, `flags text[] not null default '{}'`, `received_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`, `cancelled_at timestamptz`, `cancelled_by_staff uuid references staff(id)`, `cancel_reason text` |
| `order_code`, `customer_phone`, `customer_email`, `fulfil_at` not null | nullable, with `orders_online_contact` check: `channel = 'counter' or (order_code, customer_phone, customer_email, fulfil_at all not null)` |
| `orders_total_is_subtotal_plus_fee` | replaced by `orders_total_math`: `total = subtotal - discount + delivery_fee` and `orders_discount_le_subtotal` |
| `orders_delivery_needs_address` | rewritten: delivery ⇒ address, barangay, zone not null; any other fulfilment ⇒ all three null and fee 0 |
| `gcash_reference`, `payment_proof_path`, `verified_by`, `verified_at` | moved into `payments`, then dropped from `orders` (with `orders_gcash_reference_idx`) |
| `order_items` | renamed `order_lines`; `menu_item_id`→`item_id`, `name_snapshot`→`item_name`, `base_price_centavos`→`unit_price_centavos`, `item_note`→`note`; new `variant_id uuid references menu_variants(id) on delete set null`, `variant_code text not null`, `variant_label text not null`; `size` dropped after backfill (`variant_code = size::text`, label `Medium/Large/XL/Hot`, `variant_id` joined on item + code); `order_items_ice_matches_size` replaced by `order_lines_ice_shape`: `(ice_level is null and ice_serve is null) or (ice_level = 'none' and ice_serve is null) or (ice_level <> 'none' and ice_serve is not null)`; new index `order_lines_order_idx (order_id)` |
| `order_item_modifiers` | renamed `order_line_options`; `order_item_id`→`line_id`, `modifier_id`→`option_id`, `name_snapshot`→`option_name`; new `group_name text not null` (backfilled from `options → option_groups.name`, `''` when the option is gone) |
| `drink_size` type | dropped (nothing uses it after `size` goes) |

New tables:

```
ticket_counters (business_day date, series text check (series in ('C','W')), last_number int not null,
                 primary key (business_day, series))
payments        (id uuid pk default gen_random_uuid(), order_id uuid not null references orders(id) on delete cascade,
                 method text not null check (in ('cash','gcash')), amount_centavos int not null check (>= 0),
                 tendered_centavos int, change_centavos int,
                 check (method <> 'cash' or tendered_centavos - change_centavos = amount_centavos),
                 reference text, proof_path text,
                 status text not null check (in ('recorded','pending_verification','verified','rejected','refunded')),
                 verified_by uuid references staff(id), verified_at timestamptz, recorded_at timestamptz not null default now())
                 unique index payments_one_live (order_id) where status <> 'rejected'; index payments_reference_idx (reference)
order_events    (id uuid pk default gen_random_uuid(), device_id uuid, order_id uuid not null references orders(id) on delete cascade,
                 kind text not null check (in ('created','prep_status','payment','cancelled','note')),
                 from_value text, to_value text, staff_id uuid references staff(id),
                 occurred_at timestamptz not null default now(), received_at timestamptz not null default now(),
                 result text not null default 'applied' check (in ('applied','flagged','held')), reason text,
                 unique (device_id, id))
```

Indexes: `orders_w_ticket_unique unique (business_day, ticket_number) where ticket_series = 'W'`.

Backfill (existing rows are all online): `business_day = (created_at at time zone 'Asia/Manila')::date`; `ticket_number = row_number() over (partition by business_day order by created_at, id)`; `ticket_counters` seeded with each day's max; prep/payment from the spec's mapping table (`awaiting_verification → placed + pending_verification`, `confirmed → placed + paid`, `preparing/ready/out_for_delivery/completed → same + paid`, `rejected → cancelled + rejected`, `cancelled → cancelled + refunded` when `verified_at` is set, else `cancelled + rejected`); one `payments` row per order (`gcash`, `amount = total`, reference, proof path, status `pending_verification | verified | rejected | refunded` matching the payment status, verifier, `recorded_at = created_at`); one `order_events` row per order (`kind 'created'`, `to_value` the new prep status, `occurred_at = created_at`). `menu_version` stays null for old rows.

Policies and grants:
- Drop `staff update orders` (the website stops writing orders). Keep staff and customer **read** policies on `orders`, `order_lines`, `order_line_options` (renames keep them; the test proves it).
- `payments`, `order_events`: RLS on; `staff read payments` / `staff read order events` (select using `is_active_staff()`); no customer policy (spec: payments denied to customers). `ticket_counters`: RLS on, no `anon`/`authenticated` policy.
- `kennko_api`: `select, insert, update` on `orders, order_lines, order_line_options, payments, order_events, ticket_counters`; `select` on `delivery_zones, menu_snapshots` (already), `staff` (already). One `to kennko_api using (true) with check (true)` policy per table per command it needs.

- [ ] **Step 1: Write `orders-schema.test.ts`** using `startTestDb({ seedBefore: { migration: '0014_unified_orders.sql', sql: LEGACY } })`, where `LEGACY` inserts a staff owner, a customer `auth.users` row, one delivery zone, and eight legacy orders (one per old status, two of them on the same Manila day 23:30 and 00:30 local to prove the day split, the `cancelled` one with `verified_at` set) each with one `order_items` row and one modifier. Assertions:
  - each of the eight rows has the mapped `(prep_status, payment_status)` and exactly one payment with the mapped status, reference and proof path;
  - W numbers restart per Manila day and follow `created_at`; `ticket_counters` holds each day's max;
  - lines carry `variant_code` `'M'`, `variant_label` `'Medium'`, a `variant_id` when the variant exists; options carry `group_name`;
  - `asUser(customerId)` still selects the customer's own order and lines, and selects **no** rows from `payments`;
  - inserting an online order without `order_code` fails `orders_online_contact`; a counter `dine_in` order with no phone, email, code or fulfil_at succeeds; `total ≠ subtotal − discount + fee` fails `orders_total_math`; a second non-rejected payment for one order fails `payments_one_live`;
  - as `authenticated` staff, `update orders` affects 0 rows (policy dropped).
- [ ] **Step 2: Run** `npm test -w @kennko/api -- orders-schema` — FAIL (migration missing).
- [ ] **Step 3: Write `0014_unified_orders.sql`** per the tables above. Order inside the file: add columns nullable → backfill → set not null → swap constraints → create payments/events from old columns → drop old columns and types → renames → policies and grants.
- [ ] **Step 4: Run** the test, then root `npm test` (the API's existing migration tests must still pass) and `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(api): migration 0014 — unified orders, payments, tickets, events`

---

### Task 4: `POST /v1/orders` — online checkout in the API

**Files:**
- Create: `apps/api/src/storage.ts`, `apps/api/src/orders/create.ts`, `apps/api/src/orders/tickets.ts`, `apps/api/src/routes/orders.ts`, `apps/api/test/orders-create.test.ts`
- Modify: `apps/api/src/config.ts`, `apps/api/src/create-app.ts`, `apps/api/src/index.ts`, `apps/api/src/auth.ts`, `apps/api/README.md` (env list)

**Interfaces:**
- Consumes: Task 1 vocabulary; Task 2 `validateCheckout`, `priceOnlineOrder`, `ridingDistanceKm`, `deliveryFeeCentavos`, `verifyPin`; Task 3 schema.
- Produces:
  - `config.ts`: `Config` gains `supabaseServiceRoleKey: string` from env `SUPABASE_SERVICE_ROLE_KEY` (required).
  - `storage.ts`: `type ProofStore = { upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>; remove(path: string): Promise<void>; signedUrl(path: string, seconds: number): Promise<string> }` and `createProofStore(supabaseUrl, serviceKey): ProofStore` (Storage REST on bucket `payment-proofs`).
  - `AppDeps` gains `proofs: ProofStore` and `now(): Date` (tests pin the clock).
  - `auth.ts`: `optionalUser(deps): MiddlewareHandler<AppEnv>` sets `c.var.userId: string | null`; a missing or invalid token sets `null` (Ruling 4). `AppEnv.Variables` gains `userId`.
  - `tickets.ts`: `nextTicket(tx, businessDay: string, series: 'W'): Promise<number>` — `insert into ticket_counters … on conflict (business_day, series) do update set last_number = ticket_counters.last_number + 1 returning last_number`.
  - `create.ts`: `createOnlineOrder(deps, input: { order: CheckoutInput & { claimedTotalCentavos: number }; proof: { bytes: Uint8Array; contentType: string }; userId: string | null }): Promise<CreateOrderResult>` where
    `type CreateOrderResult = { ok: true; orderId: string; orderCode: string; ticket: string; items: { name: string; variantLabel: string; quantity: number; ice: string | null; note: string | null }[]; subtotalCentavos: number; deliveryFeeCentavos: number; totalCentavos: number } | { ok: false; status: 400 | 409 | 500 | 503; code: string; errors: string[] }`.
  - Route: `POST /v1/orders`, `multipart/form-data` with fields `order` (JSON, today's `SubmittedOrder` shape) and `proof` (file). `201` with the ok result minus `ok`; errors as `{ code, message: errors[0], errors }` with the result's status.

Behaviour (same order of checks and the same error codes as today's `apps/web/lib/orders/create.ts`, which this replaces): `MALFORMED` (400, missing field or bad JSON) → `INVALID` (400, `validateCheckout`) → `EMPTY_CART` → `BAD_PROOF` (400; JPEG/PNG/WebP/HEIC up to 5 MB, the website's `validateImage` rules copied into the API) → latest snapshot read **from the database** (`menu_snapshots` order by version desc limit 1; none → 503 `MENU_UNAVAILABLE`) → `priceOnlineOrder` (409 `ITEM_UNAVAILABLE | SIZE_UNAVAILABLE | MODIFIER_UNAVAILABLE`, 400 `BAD_QUANTITY`) → delivery zone and fee (409 `OUTSIDE_SERVICE_AREA | ZONE_NOT_LOCATED | PIN_MISMATCH`) → total vs claimed (409 `PRICE_CHANGED`) → upload proof to `proofs/<orderCode>/<uuid>.<ext>` (500 `UPLOAD_FAILED`) → one `sql.begin` transaction: `nextTicket`, insert order (`channel 'online'`, `prep_status 'placed'`, `payment_status 'pending_verification'`, `business_day = manilaDay(now)`, `ticket_series 'W'`, `menu_version` = the snapshot's, `customer_user_id = userId`, today's normalisation of name/phone/email/reference), lines, options, payment (`gcash`, `pending_verification`, amount = total, reference upper-cased, proof path), event (`created`, `to_value 'placed'`). A unique violation on `orders_order_code_key` regenerates the code and retries the transaction (max 3, Ruling 5). Any other failure → remove the uploaded proof, 500 `ORDER_FAILED`.

- [ ] **Step 1: Write `orders-create.test.ts`** (pattern: `apps/api/test/menu-routes.test.ts`; seed a published snapshot with one drink and one add-on, one zone, a fake `ProofStore` that records calls and can be told to fail, `now` pinned to `2026-11-21T02:00:00Z`). Tests:
  - happy pickup order → 201, `ticket` `'W1'`, second order same day `'W2'`; rows exist in all five tables; payment amount equals order total; `menu_version` set; proof uploaded once under `proofs/<orderCode>/`;
  - each error code above with its status (one test per code; `PRICE_CHANGED` when the claimed total is off by 1 centavo);
  - **Review Focus 1:** proof store succeeds, then the database write fails — the test creates a trigger on `order_lines` that raises when `item_name = 'Boom Latte'` and orders that drink → 500 `ORDER_FAILED`, zero rows in `orders` and `payments` (the transaction rolled back), `proofs.remove` called with the uploaded path;
  - **Review Focus 5:** an `Authorization` header with an expired JWT → 201 and `customer_user_id` null; a valid customer JWT → `customer_user_id` = its `sub`;
  - the order code collision path: pre-insert an order whose code the fake generator returns first → 201 with a different code.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** in the files above; mount `app.route('/v1/orders', ordersRoutes(deps))` in `create-app.ts`; `index.ts` builds `proofs` from config. Make the code generator injectable through `AppDeps` (`orderCode?: () => string`, default `KNK-` + 6 chars from `ACDEFHJKLMNPRTUVWXY34679`).
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(api): online checkout endpoint`

---

### Task 5: Staff order actions in the API

**Files:**
- Create: `apps/api/src/orders/actions.ts`, `apps/api/src/routes/payments.ts`, `apps/api/test/orders-actions.test.ts`
- Modify: `apps/api/src/routes/orders.ts`, `apps/api/src/create-app.ts`

**Interfaces:**
- Consumes: `requireStaff(deps, role?)`, Task 1 `canMovePrep`, Task 3 schema.
- Produces (all `requireStaff(deps)` unless noted; every success appends one `order_events` row with `staff_id` and `result 'applied'`, and bumps `orders.updated_at`):
  - `PATCH /v1/orders/:id` body `{ prepStatus?: PrepStatus; staffNote?: string }` (zod; at least one field; `staffNote` ≤ 500 chars) → `200 { prepStatus, paymentStatus }`. Prep moves require `payment_status = 'paid'` and `canMovePrep(current, to, fulfilment)`; otherwise 409 `BAD_TRANSITION`. Event kinds `prep_status` / `note`.
  - `POST /v1/orders/:id/cancel` (**owner**, Ruling 6) body `{ reason: string }` (1–300 chars) → online orders only (counter → 409 `COUNTER_ORDER`); prep not `completed`/`cancelled` (else 409 `BAD_TRANSITION`); sets `prep_status 'cancelled'`, `cancelled_at/by/reason`; live payment `verified → refunded` (order `payment_status 'refunded'`) or `pending_verification → rejected` (order `rejected`); event `cancelled`.
  - `POST /v1/payments/:id/verify` → payment `pending_verification → verified` (`verified_by`, `verified_at`), order `payment_status 'paid'`; event `payment` `pending_verification → paid`.
  - `POST /v1/payments/:id/reject` body `{ reason: string }` (1–300) → payment `pending_verification → rejected`, order `payment_status 'rejected'`, `prep_status 'cancelled'`, `staff_note = reason`; event `payment`.
  - Every write is a compare-and-set inside one transaction (`… where id = $1 and status = <expected> returning`); zero rows → 409 `STATUS_CHANGED` with the current statuses in `errors[0]`. Unknown id → 404 `NOT_FOUND`. The payment status and the order's `payment_status` always change in the same transaction (spec).

- [ ] **Step 1: Write `orders-actions.test.ts`** (seed via `createOnlineOrder` from Task 4 or direct inserts; owner and barista JWTs). Tests:
  - verify then `preparing → ready → completed` for pickup; `preparing → out_for_delivery → completed` for delivery; events table has one row per step with the staff id;
  - **Review Focus 2:** verify twice → second 409 `STATUS_CHANGED`, one `payment` event; reject after verify → 409; verify after reject → 409;
  - **Review Focus 3:** `placed → completed` → 409 `BAD_TRANSITION`; `preparing` while payment pending → 409; barista cancel → 403; cancel a completed order → 409; cancel a paid order → payment `refunded`, order `cancelled + refunded`; cancel a pending order → `cancelled + rejected`;
  - staff note only → 200, event `note`; empty body → 400.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**; mount `app.route('/v1/payments', paymentRoutes(deps))`.
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(api): staff order and payment actions`

---

### Task 6: Website checkout through the API; customer reads on the new schema

**Files:**
- Modify: `apps/web/app/api/orders/route.ts`, `apps/web/lib/orders/lookup.ts`, `apps/web/lib/orders/history.ts`, `apps/web/app/order/[code]/page.tsx`, `apps/web/app/orders/page.tsx`, `apps/web/lib/email/templates.ts` (item `size` → `variantLabel`, plus `ticket`)
- Create: `apps/web/lib/api/client.ts`, `apps/web/app/api/orders/route.test.ts`
- Delete: `apps/web/lib/orders/create.ts`, `apps/web/lib/orders/create.test.ts`

**Interfaces:**
- Consumes: Task 4 route contract; `orderStage` (Task 1).
- Produces:
  - `lib/api/client.ts` (server-only): `apiBase(): string | null` (from `KENNKO_API_URL`, trailing slash stripped) and `staffFetch(path: string, init: RequestInit & { timeoutMs?: number }): Promise<Response>` that adds the signed-in staff's Supabase access token (same lookup as `lib/menu/publish.ts`, which is refactored to use it).
  - Proxy `POST /api/orders`: keeps `ORDERING_DISABLED` (503) and `RATE_LIMITED` (429) exactly as today; forwards the incoming `FormData` unchanged to `${apiBase()}/v1/orders` with `Authorization: Bearer <customer access token>` when a customer session exists, `x-forwarded-for` copied, 20 s timeout; passes the API's status and `{ code, errors }` through; API unreachable or no base URL → 503 `{ code: 'ORDERING_UNAVAILABLE', errors: ['Ordering is unavailable right now. Please try again in a few minutes.'] }`. On 201 it sends today's staff alert (subject now leads with the ticket: `New order W3 · KNK-ABC123 — ₱… (pickup)`) and returns `201 { orderCode, ticket }`.
  - `lookupOrder(code)` and `getOrderHistory(customer)` select the new columns (`prep_status, payment_status, ticket_series, ticket_number, order_lines(item_name, variant_label, quantity, ice_level, ice_serve, note, order_line_options(option_name))`) and return `stage: OrderStage` plus `ticket: string` in place of `status`; the pages key their existing copy (`STATUS_COPY`, `LIVE`) by `stage` and show `Your number: W3` on the status page.

- [ ] **Step 1: Write `route.test.ts`** (mock `fetch` and the email sender): forwards the form data and the customer token; passes a 409 `PRICE_CHANGED` body through; maps a network error to 503 `ORDERING_UNAVAILABLE`; on 201 sends one staff alert whose subject starts `New order W3 · `; ordering disabled → 503 without calling `fetch`.
- [ ] **Step 2:** Update `lookup`/`history` tests (or add them if absent) for `stage` and `ticket`. **Run** — FAIL.
- [ ] **Step 3: Implement**; delete `create.ts` and its test. `OrderClient.tsx` needs no change (it reads `orderCode` and `errors`).
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` + `KENNKO_API_URL= npm run build -w @kennko/web` — PASS.
- [ ] **Step 5: Commit** `feat(web): checkout through the API; order pages read the unified schema`

---

### Task 7: Admin orders on the new schema and through the API

**Files:**
- Modify: `apps/web/app/admin/orders/actions.ts`, `apps/web/app/admin/orders/page.tsx`, `apps/web/app/admin/orders/status.ts`, `apps/web/app/admin/orders/tabs.ts`, `apps/web/components/admin/OrderCard.tsx`, `apps/web/lib/admin/overview-data.ts` and their tests

**Interfaces:**
- Consumes: Task 5 endpoints, `staffFetch` (Task 6), `orderStage`, `nextPrepStatus`, `ticketLabel` (Task 1).
- Produces:
  - `AdminOrder` gains `paymentId: string | null`, `prepStatus`, `paymentStatus`, `stage: OrderStage`, `ticket: string`; `gcashReference`/`proofPath` now come from the order's live payment (`payments(id, reference, proof_path, status)` embedded, the non-rejected one or the newest).
  - Actions (all return `{ ok: true } | { ok: false; message: string }`, never write Supabase, `revalidatePath('/admin','layout')`):
    `confirmPayment(paymentId)` → `POST /v1/payments/:id/verify`, then today's customer confirm email;
    `rejectPayment(paymentId, reason)` → `POST /v1/payments/:id/reject`, then today's reject email;
    `advanceStatus(orderId, to: PrepStatus)` → `PATCH /v1/orders/:id`;
    `cancelOrder(orderId, reason)` → `POST /v1/orders/:id/cancel`.
    API 409 → message `This order changed on another screen. Refresh to see it.`; 403 → `Only the owner can cancel orders.`; unreachable → `Couldn't reach the server. Try again.`
  - `tabs.ts`: `check` = `payment_status = 'pending_verification'` and prep not `cancelled`; `progress` = `payment_status = 'paid'` and prep in `placed, preparing, ready, out_for_delivery`; `done` = prep in `completed, cancelled` within 7 days (by `created_at`), limit 100. `orderQueries(now)` returns the column filters for these. Open orders are still never limited.
  - `status.ts`: `nextStatus` becomes `nextStatus(order): PrepStatus | null` wrapping core `nextPrepStatus` and returning null unless paid; labels keyed by `OrderStage`; `duplicateReferences` reads the payment reference and skips rejected payments.
  - `OrderCard`: shows the ticket (`W3`) beside the code; the existing buttons call the new actions; owners get **Cancel order** (asks for a reason, `window.confirm`) on any order not completed or cancelled; action errors show inline (`role="alert"`).
  - `overview-data.ts`: `countOrdersToCheck` counts `payment_status = 'pending_verification'` and prep not cancelled; `recentOrders` returns `stage` and `ticket`.

- [ ] **Step 1: Update the tests first**: `tabs.test.ts` (membership by the new columns, 7-day boundary kept), `status.test.ts` (`nextStatus` null while unpaid; delivery flow), `overview-data.test.ts`, and a new `actions.test.ts` (mock `staffFetch`: success path sends the email once; 409 maps to the message above; no Supabase write is attempted — the mocked server client's `from().update` is never called). **Run** — FAIL.
- [ ] **Step 2: Implement.** Grep for any leftover `status`/`order_items`/`gcash_reference` reads under `apps/web` (`grep -rn "order_items\|order_item_modifiers\|gcash_reference\|payment_proof_path\|'awaiting_verification'" apps/web --include=*.ts --include=*.tsx`); the only allowed hits are `OrderStage` literals.
- [ ] **Step 3: Run** root `npm test` + `npm run typecheck` + the web build — PASS.
- [ ] **Step 4: Commit** `feat(web): admin orders read the unified schema and act through the API`

---

### Task 8: Ship it

**Files:** none (deploy and verification). Julius runs the migration; the guard hook blocks Claude from running it.

- [ ] **Step 1:** Root `npm test` and `npm run typecheck` on the branch tip.
- [ ] **Step 2:** Add `SUPABASE_SERVICE_ROLE_KEY` to the `kennko-api` Vercel project (production, sensitive), copied from `apps/web/.env.local` without printing it.
- [ ] **Step 3:** Deploy the API (`vercel link --project kennko-api`, delete the root `.env.local` it writes, `vercel deploy --prod`). The menu routes must keep answering (`GET /v1/menu` 200).
- [ ] **Step 4:** Julius applies 0014 from `apps/api`: `npx supabase db push --remote --dry-run`, check it lists only `0014_unified_orders.sql`, then run it without `--dry-run`.
- [ ] **Step 5:** Deploy the website immediately after (same link/deploy steps with `--project kennko`).
- [ ] **Step 6:** Smoke test: `POST https://kennko-api.vercel.app/v1/orders` with an empty form → 400 `MALFORMED`; `PATCH /v1/orders/<uuid>` without a token → 401. Julius places one real test order on `/order` (pickup, small amount), then in admin: confirm payment → it moves to In progress with its W number → advance to completed; places a second and cancels it as owner. Check the customer status page shows `Your number: W…`.

## Self-review notes

- Spec coverage for roadmap row 2: unified orders ✔ (Task 3), payments ✔ (3, 4, 5), ticket numbers ✔ (3, 4), events ✔ (3, 4, 5), checkout via API incl. proof upload ✔ (4, 6), admin order actions via API ✔ (5, 7), admin cancels online orders only ✔ (5), live payment equals total ✔ (Task 4 test), website no longer writes orders ✔ (3 drops the update policy; 7 test). Deferred by design: device/shift columns and counter writes (Plans 3–4), food online, moving reads off the service key (Plan 6), API-side rate limiting.
- Concurrency limit: the PGlite harness shares one backend session, so true concurrent W numbering cannot be tested here; correctness rests on `insert … on conflict do update … returning` (atomic per row) plus the `orders_w_ticket_unique` index, which turns any bug into a failed insert rather than a duplicate number.
