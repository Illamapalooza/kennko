# Kennko backend: one source of truth for every app

**Status:** for approval, 2026-11-20. Reviewed for robustness (schema and sync) and by a cold-read builder; their
findings are folded in.

**Decided by Julius:** a backend app in front of Supabase (approach B); the till keeps selling offline; one PIN per
person, asked on key actions; GCash payments are checked in website admin, and only paid orders reach the till;
hosting on Vercel Pro.

Calls Claude made are marked *(Claude's call)*.

## Why

Kennko runs three apps that each keep their own idea of the menu and the orders:

| App | Menu comes from | Orders go to |
|---|---|---|
| Website (`apps/web`) | Supabase, live | Supabase `orders` (online only) |
| Till (`apps/pos`) | Its own built-in copy (`packages/core/src/seed-menu.ts`), or a manual pull | `apps/pos/data/pos.db` on the shop computer, nowhere else |
| Wall (`wall`) | A hand-kept `wall/menu.json` | The till's local feed |

On 2026-11-20 all three menus match, but only because nobody has edited one yet. A price change in admin does not
reach the till; food exists only as hard-coded text on the landing page; sales never leave the shop computer; online
orders cannot reach the till's queue because the two order models differ.

Julius wants **one source of truth**: one menu and one set of orders and money records that every app follows.

## Goals

1. **One menu** (drinks and food, sizes, options, prices, sold-out) edited in one place, followed by every app.
2. **One order record** for every sale: counter, online pickup, online delivery.
3. **The till keeps selling offline** and catches up when the connection returns, with no lost and no duplicated
   sales.
4. **One place for the rules** (pricing, discounts, ticket numbers, status flow): `packages/core`, used by the
   backend and by the till offline.
5. Shifts, cash and sales reports from every channel in one database, off the shop computer.
6. Paid online orders appear in the till's queue.
7. Every void, cash out and till close is credited to a person.

## Non-goals

- GCash integration. Payment stays recorded and checked by a person.
- More than one shop. (A `location_id` later is a contained migration.)
- Inventory counts. Sold-out is a switch.
- Loyalty in the database. The perks card stays paper.
- Replacing Supabase. It stays the database, sign-in and file storage.

## Anti-goals (failure even if it works)

- **A sale blocked by the network.** The till never waits on the backend to ring up, print or hand over.
- **A counter sale lost or counted twice**, including one the backend disagrees with. Money already in the drawer is
  a fact; the backend records it and flags problems, it never refuses it.
- **The till holding customer data it does not need.** It never sees emails, GCash references or payment receipts.
- **Rules forked again.** No pricing logic in SQL or in an app outside `packages/core`.

## Approaches considered

| | Approach | Trade-off | Verdict |
|---|---|---|---|
| A | Supabase as the hub; rules in SQL; till syncs straight to Supabase | Nothing new to host, but rules leave `packages/core` and a write-capable database key sits on the shop computer | Rejected |
| **B** | **`apps/api` in front of the same Supabase Postgres; owns the rules via `packages/core`; till syncs through it** | One more deploy | **Chosen** |
| C | Shop computer as main server, mirrored to the cloud | Website and online orders go down whenever the shop computer is off | Rejected |

## Architecture

```
                 ┌──────────────── Supabase ────────────────┐
                 │ Postgres: the source of truth             │
                 │ Auth: owner/manager logins, customer Google│
                 │ Storage: menu-images, payment-proofs      │
                 └───────────────▲──────────────────────────┘
                                 │ least-privilege DB role (server side only)
                       ┌─────────┴──────────┐
                       │      apps/api       │  Hono, Vercel Pro, region next to Supabase
                       │ rules: @kennko/core │
                       └──▲───────▲───────▲──┘
   owner/customer JWT     │       │       │   device token
              ┌───────────┘       │       └──────────────┐
          apps/web           GET /v1/menu            apps/pos (till)
  (site, checkout, admin)   (public, cached)     SQLite + outbox, works offline
                                                          │ shop LAN
                                                        wall
```

- **Supabase Postgres is the single source of truth.**
- **`apps/api` owns every write that carries a rule:** orders on any channel, payments, prep status, shifts, cash,
  devices, sync, menu publishing.
- **The website keeps its service key for now** *(Claude's call)*. It still uses it for order lookup, customer
  history, admin order actions and proof viewing (`apps/web/lib/supabase/admin.ts`). Checkout and admin order
  writes move to the API in this project; the remaining reads move later, and the key is removed from the website
  when the last one does. Until then the website must not write orders, payments or shifts directly.
- **Admin menu editing may stay direct to Supabase with RLS** (owner only), followed by an explicit "Publish menu"
  call to the API. Nothing reads the menu tables for selling: **every app sells from a published snapshot.**
- **The till is offline-first.** SQLite stays its working store. Each change is written locally **with its outbox
  row in the same SQLite transaction**, and a background loop pushes and pulls whenever the backend is reachable.
- **The wall follows the till over the LAN** as today. `wall/menu.json` is retired.

## Schema

Conventions: `uuid` keys; `created_at`, `updated_at timestamptz`; money as `int` centavos with `check (>= 0)`;
**`text` + `check` instead of Postgres enums** for anything that may grow. Rows the till creates are given their id
**by the till**, so a retried push is the same row.

The database connection the API uses is a dedicated Postgres role with only the grants it needs, not `postgres`
*(from review)*. RLS stays on for every table; new tables deny `anon` and `authenticated` by default.

### Menu

The current menu (fixed sizes M/L/XL/HOT, one global list of add-ons) cannot describe food. It moves to **variants**
and **option groups attached per item**.

```
menu_categories     id, name unique, kind ('drink'|'food'), sort_order, is_active
menu_items          id, category_id → menu_categories, name, description, image_path, is_bestseller,
                    sort_order, is_archived, is_available, availability_changed_at
                    unique (category_id, name)
menu_variants       id, item_id → menu_items, code ('M','L','XL','HOT','REG'…), label, price_centavos,
                    temperature ('iced'|'hot'|'none'), sort_order, is_archived,
                    is_available, availability_changed_at
                    unique (item_id, code)
option_groups       id, name unique, min_select, max_select, sort_order
                    check (0 <= min_select and min_select <= max_select)
options             id, group_id → option_groups, name, price_centavos, sort_order, is_archived,
                    is_available, availability_changed_at
                    unique (group_id, name)
item_option_groups  item_id → menu_items, group_id → option_groups, sort_order, primary key (item_id, group_id)
discount_presets    id, label, kind ('percent'|'amount'), value, is_active, sort_order
menu_snapshots      version bigint primary key, body jsonb, body_hash unique, published_at, published_by
menu_publish_lock   single row, used only to serialise publishing
```

- **Data maps from today:** each `menu_item_prices` row becomes a variant (`HOT` is `temperature='hot'`, the rest
  `'iced'`). Add-ons (0 to 5), Milk of Choice (0 to 1), Cream Supreme (0 to 1) become option groups attached to
  every drink. Existing ids are kept.
- **Food:** Cookies has one `REG` variant at ₱60 and a required Flavour group (min 1, max 1: Original, Chocolate,
  Red Velvet). Fries: `REG` ₱85, Flavour (Original, Cheese, BBQ, Sour Cream). Empanada: `REG` ₱45, "Chicken" as
  description. The landing page's hard-coded list goes once this is live.
- **Ice** follows `temperature`: only `iced` variants take ice choices. `packages/core/ice.ts` switches from "size
  is HOT" to temperature.
- **Nothing sold is ever deleted**; `is_archived` hides it.
- **Sold-out** is the `is_available` column on items, variants and options *(from review: no polymorphic table)*.
  Sold-out changes are not part of the priced snapshot and do not need a publish.
- **Publishing:** `POST /v1/menu/publish` (owner) takes the lock row `for update`, builds the snapshot from the menu
  tables, and inserts `max(version)+1` in one transaction. If `body_hash` matches the latest, nothing is inserted.
  Admin's menu screens call it after each save. No background job, no dirty flag, no scheduler *(from review)*.
- **Snapshots carry discount presets** too, so the till prices discounts offline from the same version.
- **Every order stores the `menu_version` it was priced against.** The API re-prices online orders against the
  current version and rejects mismatches, as checkout does today. It re-prices counter orders against their own
  version only **to flag** differences (see Sync).

### Orders

One table for every channel. Today's two status models mix payment and preparation, so they are split.

```
orders
  id                 uuid (the till's for counter, the API's for online)
  channel            'counter' | 'online'
  fulfilment         'dine_in' | 'takeout' | 'pickup' | 'delivery'
  check (channel = 'counter' and fulfilment in ('dine_in','takeout')
      or channel = 'online'  and fulfilment in ('pickup','delivery'))
  business_day       date, Manila day, set by the creator and never recomputed
  ticket_series      'C' | 'W'          check (series matches channel)
  ticket_number      int                -- said aloud: "C12", "W3"
  order_code         text unique        -- online lookup code; null for counter
  prep_status        'placed' | 'preparing' | 'ready' | 'out_for_delivery' | 'completed' | 'cancelled'
  payment_status     'unpaid' | 'pending_verification' | 'paid' | 'rejected' | 'refunded'
                     -- written only in the same transaction as the payment row it mirrors
  customer_name      not null
  customer_phone, customer_email      -- required when channel = 'online'
  customer_user_id   → auth.users, online only
  delivery_address, delivery_barangay, delivery_zone_id, delivery_lat, delivery_lng,
  delivery_accuracy_m, delivery_distance_km     -- delivery only, as today's checks
  fulfil_at          timestamptz
  menu_version       → menu_snapshots, nullable (null only for imported history)
  subtotal_centavos, discount_centavos, delivery_fee_centavos, total_centavos
  check (discount_centavos <= subtotal_centavos)
  check (total_centavos = subtotal_centavos - discount_centavos + delivery_fee_centavos)
  discount_label, discount_kind, discount_value
  customer_note, staff_note
  device_id          → devices, counter only
  shift_id           → shifts, counter only
  opened_by_staff    → staff (who opened the shift: the sale's attribution)
  created_at (creator's clock), received_at (server clock), updated_at
  cancelled_at, cancelled_by_staff, cancel_reason
  flags              text[] default '{}'   -- e.g. 'reprice_mismatch', 'ticket_duplicate', 'clock_skew', 'legacy'

index unique (business_day, ticket_number) where ticket_series = 'W'
index        (device_id, business_day, ticket_number) where ticket_series = 'C'   -- not unique: duplicates are flagged

ticket_counters    business_day, series, last_number, primary key (business_day, series)
                   -- W numbers come from an upsert ... returning, never max()+1

order_lines
  id, order_id → orders, item_id, variant_id (nullable, on delete set null)
  item_name, variant_code, variant_label        -- snapshots; receipts never change
  unit_price_centavos, quantity check (quantity between 1 and 20), line_total_centavos
  ice_level, ice_serve, note

order_line_options
  id, line_id → order_lines, option_id (nullable), group_name, option_name, price_centavos

payments
  id (creator-generated), order_id → orders
  method 'cash' | 'gcash', amount_centavos
  tendered_centavos, change_centavos      check (method <> 'cash' or tendered - change = amount)
  reference, proof_path                   -- online GCash only; never sent to the till
  status 'recorded' | 'pending_verification' | 'verified' | 'rejected' | 'refunded'
  verified_by → staff, verified_at, recorded_at, device_id
  index unique (order_id) where status <> 'rejected'    -- one live payment per order
  index (reference)                                     -- duplicates flagged in admin, not blocked

order_events   -- append-only history, and the idempotency record for pushes
  id (creator-generated), device_id (null for API/admin), order_id
  kind ('created','prep_status','payment','cancelled','note'), from_value, to_value,
  staff_id, occurred_at (device clock), received_at, result ('applied','flagged','held'), reason
  unique (device_id, id)
```

- **The live payment always equals the order total** (checked by the API in the same transaction, and by a test).
  **A refund is a status change** on that payment, not a second row.
- **Cancelling a counter order** happens only on the till, inside an open shift, as today, so a closed shift's cash
  figures never change afterwards. Admin can cancel online orders only.
- **Mapping from today's data:**

  | Today | Becomes |
  |---|---|
  | Till `queued` / `preparing` / `serving` / `done` | `placed` / `preparing` / `ready` / `completed` |
  | Till `voided` | `cancelled` + payment `refunded` |
  | Web `awaiting_verification` | `placed` + `pending_verification` |
  | Web `confirmed` | `placed` + `paid` |
  | Web `preparing` / `ready` / `out_for_delivery` / `completed` | same prep status + `paid` |
  | Web `rejected` | `cancelled` + `rejected` |
  | Web `cancelled` | `cancelled` + `refunded` if a payment was verified, else `rejected` |

  Existing online rows get `business_day` from `created_at` in Manila and W numbers in creation order.

### Shifts and cash

```
shifts       id (till-generated), device_id, opened_at, opened_by_staff, opening_float_centavos,
             closed_at, closed_by_staff, counted_centavos, expected_centavos, note
             index unique (device_id) where closed_at is null
cash_moves   id (till-generated), shift_id → shifts, kind ('in'|'out'), amount_centavos, reason, at, staff_id
```

### Staff and devices

```
staff     id, user_id → auth.users (nullable, unique)   -- only owner/manager have a website login
          full_name, role ('owner'|'manager'|'barista'), is_active, pin_hash, pin_updated_at
devices   id, name, ticket_series ('C'), token_hash, pairing_code_hash, pairing_expires_at,
          pairing_attempts, paired_at, paired_by, last_seen_at, revoked_at
shop_settings  single row: name, address, phone, receipt_footer
delivery_zones unchanged
```

- **One PIN per person** (6 digits), asked for voids, cash out, closing the till and sold-out changes; the shift is
  opened by a person and its sales are credited to them. Baristas need no email or login. Hashes use scrypt with
  a per-row salt; the till receives hashes of **active** staff only, so it can check PINs offline.
- **On the till, the PIN is typed once and exchanged for a session cookie** for that browser tab, instead of being
  sent as `?pin=` on every request *(from review)*.
- **Pairing:** owner clicks "Add a till" in admin and gets a 6-digit code valid for 10 minutes; the till's setup
  page sends it to `POST /v1/devices/pair` and receives a long random token (only its hash is stored). Five wrong
  attempts burn the code. Revoking a device stops it at its next request. The token can only call sync and menu.
- **There is no device row for the wall**; it never talks to the API.
- **Timezone is Manila, fixed in code**, not a setting.

## Sync (till ↔ API)

```
Till                                          API
 local write + outbox row (one SQLite tx)
          ──push──▶  POST /v1/sync/push  { events: [...] }   (≤ 50 per request)
                       per request: pg_advisory_xact_lock(device)
                       per event, one transaction: insert order_events row
                         on conflict (device_id, id) do nothing → "duplicate"
                         else apply → "applied" | "flagged" | "held"
          ◀──pull──  GET /v1/sync/pull
                       returns current state, not a change log:
                       latest snapshot version (+ body if newer than the till's),
                       sold-out marks, active staff PIN hashes, shop settings,
                       paid online orders that are not finished, plus any updated in the last 24 hours
```

- **Pull returns state, not changes** *(from review)*. Everything the till needs is small, so it is cheaper and safer
  than a cursor over a change log, which can skip rows that commit out of order.
- **Online orders in the till:** only `payment_status = 'paid'`, with name, W number, items, pickup or delivery,
  time and note. For delivery also the address, barangay and phone, because the counter hands the order to a rider
  *(Claude's call)*. Never email, GCash reference or receipt. The columns sent are an explicit allowlist with a
  test.
- **Counter events are facts.** An order the till pushes is always stored. If it re-prices differently against its
  own snapshot, has an unknown or old version, or repeats a C number, it is stored as sent with a flag
  (`reprice_mismatch`, `unknown_version`, `ticket_duplicate`) and shown in admin. No age limit on versions for
  counter orders.
- **Held events:** an event that depends on an event the API could not apply (for example a status change for an
  order it never received) is held and retried on later pushes, never dropped.
- **Ordering:** a device's events apply in its outbox order inside the advisory lock, so a retried push running
  alongside the first cannot double-apply.
- **When it runs:** right after each local change, then every 15 seconds while online, with backoff offline. The till
  shows "Offline: 12 sales waiting to send", never a blocking dialog.
- **Conflicts between the till and admin** (prep status, sold-out) resolve by **the order the server receives
  them**, not device clocks *(from review)*. The till's own undo keeps working as today.
- **Clocks:** the till compares its clock with the API's `Date` header and warns when off by more than 5 minutes.
  Orders whose `business_day` disagrees with `received_at` by more than a day get a `clock_skew` flag.
- **One-time `pos.db` import:** the till first stores a permanent UUID for each existing local row, derived as
  UUIDv5 of (device id, table, local id), so re-running is harmless. History is sent through a separate import
  endpoint in chunks: lines as name snapshots with null menu refs, `menu_version` null, flag `legacy`, staff null,
  voids as cancelled plus refunded. It is never re-priced.

## API (`apps/api`)

- **Stack** *(Claude's call)*: Hono on Node, its own Vercel project on the Pro team, region pinned next to Supabase;
  `zod` on every request; postgres.js over Supabase's transaction pooler (`prepare: false`, one connection per
  function instance, transaction-scoped locks only); `vitest` with a local Supabase (`supabase start`). Rules from
  `@kennko/core`.
- **Auth:** owner/manager and customers send their Supabase JWT, verified against the project's published keys
  (JWKS), and `staff.is_active` is rechecked on every request. Devices send their token. The public menu needs none.
- **Endpoints, first cut:**
  - `GET /v1/menu` (public, cached, ETag = version), `GET /v1/menu/:version`, `POST /v1/menu/publish` (owner)
  - `POST /v1/orders` (online checkout, replacing the website's order-creation logic, including the proof upload)
  - `PATCH /v1/orders/:id` (staff: prep status, note; cancel online orders), `POST /v1/payments/:id/verify|reject`
  - `POST /v1/sync/push`, `GET /v1/sync/pull`, `POST /v1/sync/import` (devices)
  - `POST /v1/devices`, `POST /v1/devices/pair`, `DELETE /v1/devices/:id` (owner); staff and PIN management (owner)
  - `GET /v1/reports/day/:date` (owner/manager: sales across channels, cash, items, flagged orders)
- **Migrations** move to `apps/api/supabase/migrations`; 0001 to 0011 stay as history, new ones start at 0012.

## Migration notes (from review)

The switch is more than adding tables. The builder must handle, in the same migrations:

- `orders` constraints that assume online-only: `not null` on `gcash_reference`, `payment_proof_path`,
  `order_code`, phone, email; `orders_delivery_needs_address`; and `orders_total_is_subtotal_plus_fee`, which has no
  discount term. These move to payments or become channel-aware checks.
- Everything that references `menu_item_prices`, `size`, `is_available`, `drink_size` or `order_status`: RLS
  policies, the barista trigger from 0003, `order_items_ice_matches_size`, and `apps/web/lib/orders/create.ts`.
  Drop and recreate them in the same migration.
- `staff`: add `manager`, make `user_id` separate from `id`, keep the current owner row working.
- Customer history policies recreated on `order_lines` and `order_line_options`; `payments` denied to customers.
- Any compatibility views created with `security_invoker = true`, or they bypass RLS.

## Changes to each app

| App | Change |
|---|---|
| `packages/core` | Variants and option groups; ice by temperature; split prep and payment status; ticket numbering; `priceOrder(snapshot, input)`; discount presets from the snapshot. |
| `apps/web` | Checkout and admin order writes go through the API; admin gains food, variants, option groups, Publish, devices, staff and PINs, flagged orders, a day report; landing page reads food from the menu. |
| `apps/pos` | Menu from the API snapshot; outbox and sync loop; paid online orders in the queue; PIN per person with a session cookie; pairing screen; offline badge; one-time import. SQLite stays. |
| `wall` | `menu.json` retired; names from the till's feed. |

## Rollout order

1. Schema migration with backfill; the website keeps working.
2. API skeleton: health, auth, publish and public menu.
3. Online checkout and admin order actions through the API; admin food and option groups.
4. Staff and PINs; device pairing; till sync; one-time `pos.db` import.
5. Paid online orders in the till queue.
6. Wall off `menu.json`; day report; remaining website reads off the service key.

Each step ships on its own and keeps every app working.

## Left to the builder

- Library versions and the folder layout inside `apps/api`.
- How the website keeps reading during step 1 (compatibility views or a coordinated switch).
- Snapshot JSON shape, as long as `priceOrder` needs nothing else.
- Backoff timings.
- Test structure, as long as these have tests: push idempotency and concurrent retries, held events, counter orders
  flagged and never refused, re-pricing against an old snapshot, the online-order column allowlist, publish under
  concurrent saves, W numbering under concurrent checkouts, and the import run twice.
