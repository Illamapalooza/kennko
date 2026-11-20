# Backend Plan 7: Customer Accounts, Digital Stamp Card, Points Ledger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- A regular gets a Kennko card in under a minute. They sign in with Google or an email link, tap "Get my Kennko card", confirm they are 13 or older and accept the privacy notice.
- Their account page shows a QR code and a typed code, their stamp card (or the paper-card notice) and their points. They can delete the account from there.
- At the counter, staff add the customer by scanning the code or typing it, online or offline, and stamp the order with one tap.
- A full card pays out one free drink: a manager PIN, the till online, two claims at once give one success.
- Paid orders earn 1 point per ₱10, and cancellations always write a reversal.
- Admin can look a customer up, switch their card to paper and back, adjust points, and settle stamps that arrived for a customer on paper.

**Architecture:**
- One migration (`0019_customers_and_stamps.sql`) adds `customers`, `stamp_cards`, `stamps`, `points_ledger`, `rate_limits`, plus `orders.customer_id` and `order_lines.is_reward`. It also adds four sync event kinds, and `owns_order()` gains the "only orders after the account was created" rule.
- All loyalty writes go through one API module (`apps/api/src/loyalty/`). Every write in it first locks the customer's row (`select … for update`).
- **Counter:** the till pushes four new facts through Plan 4's engine: `customer.linked`, `customer.unlinked`, `stamp.added`, `reward.used`. Each is stored, held or flagged, never refused. The free-drink claim is a direct online call (`POST /v1/stamp-cards/claim`) made at the moment of charging.
- **Online:** checkout links an order to the customer when they are signed in and have a card. Points are credited when admin verifies the payment.
- The till receives only a pseudonymous card summary (code, stamp count, card state, and a cat name that stays null until Plan 8), through a lookup route and the pull. An allowlist test guards both.
- **Website:** an email sign-in link (Supabase's built-in magic link, sent through the Resend SMTP already configured in Supabase), and the account page with the QR code. Admin gets a Customers screen, and Needs a look gains a "Stamps to check" block.

**Tech Stack:** Hono 4, postgres.js 3, zod 4, vitest 4, PGlite harness (`apps/api/test/pg.ts`), Next.js 16 (App Router, server actions), `@supabase/ssr` (existing), Node 24 + `node:sqlite` (till), React 19. New dependencies: `qrcode` (website, server-side SVG) and `jsqr` (till, camera decode). Both are pure JavaScript, and neither goes into the API.

**Spec:** `docs/superpowers/specs/2026-11-20-kennko-accounts-loyalty-cats-design.md`, rollout steps 1–2 only:
- Sign-in and accounts;
- Recognising a customer at the counter;
- Digital stamp card;
- Points and the cat › Earning and Reversal;
- Schema: `customers`, `stamp_cards`, `stamps`, `orders.customer_id`, `points_ledger`;
- The till's sync (push kinds and pull);
- API additions (`/v1/me`, `/v1/me/join`, `/v1/customers/:publicCode`, stamp-mode, claim, admin adjustments, Needs a look);
- Left to the builder (the must-have tests listed under Review Focus).

The binding authority for sync behaviour is `2026-11-20-kennko-backend-design.md` (Sync › "Counter events are facts", "Held events").

### Where this plan sits

Plans 1–6 are implemented (branch `feat/backend-plan-6`, latest migration `0018_attention_and_reports.sql`), so this plan adds `0019_customers_and_stamps.sql`. This is roadmap row 7. It builds on:
- Plan 4's push engine: per-device lock, receipts, entity and wait keys, savepoints, and `retryHeld`;
- Plan 5's online-order pull allowlist and its outbox exception for server ids;
- Plan 6's `/v1/me`, `auth-admin.ts`, `requireStaff(deps, 'manager')` and Needs a look.

**Out of scope (Plan 8):**
- `packages/cats` drawing, the cat customiser, cosmetics and the cosmetics shop;
- the `cats`, `cosmetics`, `customer_cosmetics`, `visits` and `shop_secrets` tables;
- wall check-in, visiting cats, the rotating wall code;
- spending points.

How this plan leaves room for Plan 8 without blocking it:
- `points_ledger.reason` already allows `'cosmetic'`, and `cosmetic_id` is a plain `uuid` column. Plan 8 adds the foreign key.
- `TillCustomer.catName` is in the type and always `null` here.
- Customer deletion cascades from `customers`, so Plan 8's tables only need `on delete cascade` to be covered.

**Also out of scope:** phone-number sign-in; moving paper stamps onto a digital card; email lookup in admin (Ruling 17); automatic stamps.

## Global Constraints

- Money is integer centavos everywhere; format only at render with `formatPesos()`. Points are integers, never money.
- Use `type`, never `interface`.
- Imports carry their extension:
  - `.ts` inside `packages/core`;
  - `.js` for relative imports in `apps/api/src`;
  - `.ts`/`.tsx` in `apps/pos`.
- The API connects as `kennko_api`. Every new table has RLS on, `revoke all … from anon, authenticated`, and explicit grants with matching `to kennko_api` policies. Privileges are tested with `has_table_privilege`. **Every API task adds its routes to `apps/api/test/sync-as-api-role.test.ts`** (seed as superuser, run the app under `set role kennko_api`). Plan 4 once shipped a missing grant.
- `kennko_api` gets DELETE only on `customers`, `stamp_cards`, `stamps`, `points_ledger`, `rate_limits` (and keeps it on `push_subscriptions`). Never on `orders`, `payments`, `sync_events` or `shifts`.
- **Lock order:** the order row (when there is one) first, then the customer row. Every ledger, card or stamp write holds the customer's row lock (`lockCustomer`).
- **Counter events are facts:** the four new kinds are stored, held or flagged, never refused, and the till keeps selling offline. The only online-only action is the free-drink claim.
- **The till never receives a real name, email, phone or point balance.** The lookup and the pull use an explicit allowlist (`TillCustomer`), and a test pins it.
- Time comes from `deps.now()` in API code, never SQL `now()`.
- No new environment variables. The magic link is configured in Supabase (Task 12), not in code.
- Brand: electric blue `#0055FF`, white, amber `#FFB830` accent, no dark styles. The account page follows the sticker style in `brand/DESIGN.md`.
- Run `npm test` and `npm run typecheck` from the repo root before every commit.

## Rulings made while planning (Claude's calls)

1. **Guest-order email matching only covers orders placed after the sign-in user was created.** This applies to `GET /v1/me/orders` and to `owns_order()`. The time used is `auth.users.created_at`, read through `authAdmin.getUser`, not `customers.created_at`, because:
   - it covers every signed-in user, card or not, and history works without a card;
   - the user cannot set it;
   - a deleted and re-created account always gets a new one.

   This intentionally narrows Plan 6's history: guest orders placed before someone first signed in no longer appear. The accounts spec wins over the 2026-08 ordering spec. The `/orders` copy changes to match.
2. **No starter cat at join.** The `cats` table belongs to Plan 8, which backfills a cat for every existing customer in its migration and creates one at join from then on. Join here creates only the `customers` row and its public code.
3. **Public code:** 8 random symbols from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (31 symbols: no 0, 1, I, L, O), plus a check symbol.
   - The check symbol is chosen so that `Σ (i+1)·value(sᵢ) ≡ 0 (mod 31)` over all nine positions. With a prime modulus and weights 1–9, every single wrong symbol and every swap of two neighbours is caught.
   - Stored as the 9 bare symbols; shown as `KC-7F3-K9Q-XAM`. The spec's `KC-7F3K-9QXA` example has 8 symbols in all, and the text ("8 characters … plus a check character") wins.
   - Input is upper-cased, and `KC`, dashes and spaces are stripped.
4. **Event kinds use the existing dot style:** `customer.linked { orderId, publicCode }`, `customer.unlinked { orderId }`, `stamp.added { orderId, stampId }`, `reward.used { claimId, orderId }`. Each one blocks and waits on `order:<orderId>`.
5. **Cards stay open for stamping until they are full, not until they are claimed.**
   - `stamp_cards.filled_at` is set when a card reaches 8 stamps.
   - The one-open-card index is `unique (customer_id) where filled_at is null`.
   - The spec's index (`where claimed_at is null`) would forbid the 9th stamp from rolling onto a fresh card while the full card waits for its claim. Several full cards may wait, and a claim takes the oldest.
6. **`repackCards(tx, customerId, now)` keeps unclaimed cards consistent.** The customer's unclaimed, unforgiven stamps are laid onto their unclaimed cards in stamp order, 8 per card:
   - full cards keep or get `filled_at`;
   - the last card may be partial;
   - empty extra cards are deleted.

   It runs after every add, removal and unclaim, so a removed stamp never leaves a gap and a 9th always rolls over. Claimed cards are frozen.
7. **Removing a stamp.** When the order is cancelled or unlinked:
   - a stamp on an unclaimed card is deleted, then the cards are repacked;
   - a stamp on a claimed card is kept and gets the `forgiven` flag.

   `stamps.order_id` is unique only among stamps that are not forgiven, so an unlinked order can still be stamped for the right customer.
8. **Unlinking** (allowed on the till until the shift closes):
   - deletes that order's stamp, as in Ruling 7;
   - deletes that order's ledger rows for that customer;
   - clears `orders.customer_id`.

   A cancellation instead appends an `order_reversed` row. Deleting the credit row on unlink keeps `unique (order_id, reason)` working when the order is then linked to the right person. The `sync_events` receipts keep the history.
9. **Points** = `floor((subtotal − discount − free-drink line total) / 1000)`, never below 0.
   - The delivery fee earns nothing.
   - A result of 0 writes no row.
   - The credit is written when the order is linked, paid and not cancelled, whichever of the link and the payment comes second.
   - Online orders link only at checkout, when the signed-in user already has a card.
10. **The free-drink claim happens at charge time, in one till request.** The till:
    1. prices and validates the order;
    2. calls `POST /v1/stamp-cards/claim` with a till-made `claimId` (5 s timeout, manager PIN);
    3. writes the sale with the ₱0 base line plus outbox `order.created`, `customer.linked` and `reward.used`.

    If the claim fails or the till is offline, nothing is saved and staff get a clear message ("charge it normally"). If the sale fails after a successful claim, the till calls `POST /v1/stamp-cards/release`, best effort. A claim never hangs in a cart.
11. **The free line:**
    - `PricedLine.reward: true`, quantity 1, base ₱0, add-ons charged, at most one per order.
    - Stored as `order_lines.is_reward`.
    - `repriceCounterOrder` expects base 0 on it.
    - More than one reward line, or a reward line with quantity above 1, is held `invalid: reward`.
12. **Voiding a free-drink order** (`order.cancelled`):
    - unclaims the card it used (`claimed_*` cleared);
    - reverses the order's points;
    - removes its stamp (Ruling 7);
    - repacks.

    The till only voids within the open shift, which gives the spec's "same shift" rule.
13. **A stamp for a customer on paper** is stored with `card_id` null and the flag `mode_was_paper`, and its receipt is answered `flagged mode_was_paper`. It appears under "Stamps to check":
    - on admin › Customers, for owners and managers;
    - in Needs a look, for owners, counted in the badge.

    *Apply* is allowed only once the customer is digital (or none) again, otherwise 409 `STILL_PAPER`; it puts the stamp on a card. *Discard* adds `discarded`. Both set `resolved_*` on the stamp and on its receipt. The generic receipt list skips `mode_was_paper`, since the stamp block carries it.
14. **Card modes:**
    - `none` → `digital` on the first stamp or by a manager;
    - `none` or `digital` → `paper` by a manager, refused with 409 `FREE_DRINK_WAITING` while a full card is unclaimed;
    - `paper` → `digital` by a manager, resuming any digital stamps from before and never adding paper ones.
    - Paper customers still earn points.
15. **What the till receives:** `TillCustomer = { code, catName: null, stampMode, stamps, fullCards }`, from:
    - `GET /v1/customers/by-code/:code` (device token, 30 lookups a minute per device, 429 beyond);
    - the pull's `customers`: customers linked through this device in the last 30 minutes (`LINKED_RECENT_MS`).

    Online orders gain `card: 'stamp' | 'stamped' | 'paper' | null`, which drives "Stamp at pickup". Nothing else about a customer reaches the till.
16. **Deleting an account** (`DELETE /v1/me`, body `{ confirm: 'DELETE' }`, any signed-in user):
    - Staff logins are refused with 409 `IS_STAFF`, since removing one would break `staff_owner_has_login`.
    - In one transaction:
      - lock the customer row;
      - null `customer_id` and `customer_user_id` on their orders;
      - delete their push subscriptions;
      - delete the `customers` row, which cascades to cards, stamps and the ledger.
    - Then `authAdmin.deleteUser` (a 404 counts as done, so a retry is safe). A failure → 502 `AUTH_DELETE_FAILED`, with the card data already gone.
    - Contact fields on online orders they placed (name, email, phone) stay as sales records. The spec names only the two ids, and Ruling 1 stops them from re-attaching.
17. **Admin lookup is by code or display name**, for owners and managers. Emails live only in `auth.users`, which `kennko_api` cannot read; looking up by email would need the service key per search.
    - Point adjustments are owner-only.
    - Card mode switches and "Stamps to check" are for managers (meaning owner or manager).
18. **`display_name`** defaults at join to the Google name or the email's local part, is 1–40 characters, editable with `PATCH /v1/me`, and is shown only to the customer and in admin.
19. **Linking on the till** happens in the cart before charging (no PIN), or afterwards from Orders or History while the order's shift is open. Unlinking works the same way. A bad check symbol is refused on the till before anything is written.
20. **Rate limits use a small Postgres table** (`rate_limits`, key + minute window), because the API runs on serverless instances that share no memory. Old windows are deleted on write.

## Review Focus

1. **Nothing awarded twice:**
   - one stamp per order (`stamps.order_id` unique among stamps not forgiven);
   - one credit and one reversal per order (`unique (order_id, reason)`);
   - one claim per full card (a conditional update under the customer lock, idempotent per `claimId`).

   Tests in Tasks 3, 5 and 6.
2. **Counter facts are never refused:**
   - a link with an unknown code, a stamp without a link, a stamp for a paper customer and a reused claim are flagged;
   - a link or stamp that arrives before its sale is held `order_unknown`, then applies;
   - an invalid reward line is held `invalid:`.

   Tests in Task 5.
3. **Privacy:**
   - the till's allowlist (Task 6);
   - deletion leaves no row pointing to the person (Task 4);
   - a re-created account never re-attaches old guest orders (Task 4);
   - the till and the wall feed carry no name, email or balance (Tasks 6 and 10).
4. **Money and points:**
   - points use the subtotal after discount, minus the free line, without the delivery fee;
   - a reversal after the points were spent leaves a negative balance;
   - the free line is ₱0 base with add-ons charged, and repricing accepts it.

   Tests in Tasks 1, 3 and 5.
5. **Every app keeps working when deployed alone, in order:**
   - the migration is additive;
   - an old till ignores the new pull keys (`customers`, `card`);
   - a new till against an old API sees no `customers` key and keeps its cache, and its lookup gets a 404 that it shows as "offline";
   - the old website ignores the new API routes.

---

### Task 1: Core — public code, points, stamp eligibility, free-drink line, event kinds

**Files:**
- Create: `packages/core/src/loyalty.ts`, `packages/core/src/loyalty.test.ts`
- Modify:
  - `packages/core/src/cart.ts`: `LineInput.reward`, `PricedLine.reward`, `priceLine`, `priceLines`;
  - `packages/core/src/sync.ts`: kinds, `TillCustomer`, `PullState.customers`, `OnlineQueueOrder.card`, `repriceCounterOrder`, `eventSummary`, `PaperStamp` and `AttentionView.stamps`;
  - `packages/core/src/index.ts`;
  - `packages/core/src/price-order.test.ts`, `packages/core/src/sync.test.ts`.

**Interfaces:**
- `loyalty.ts`:
  - `CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'`, `STAMPS_PER_CARD = 8`, `CENTAVOS_PER_POINT = 1000`, `LINKED_RECENT_MS = 1_800_000`, `LOOKUPS_PER_MINUTE = 30`.
  - `makePublicCode(randomInt: (n: number) => number): string` returns 9 bare symbols; the last one is the check symbol (Ruling 3).
  - `normalisePublicCode(input: string): string | null`: upper-cases, strips a leading `KC`, dashes and spaces; null unless it is 9 symbols from the alphabet with a valid check.
  - `formatPublicCode(bare: string): string` → `KC-XXX-XXX-XXX`.
  - `orderPoints(o: { subtotalCentavos: number; discountCentavos: number; rewardLineCentavos: number }): number` (Ruling 9).
  - `hasDrink(lines: { kind: 'drink' | 'food' | null }[]): boolean`. `null` (an unknown counter item) counts as a drink, because the till sells drinks only.
  - `type StampMode = 'none' | 'digital' | 'paper'`.
- `cart.ts`:
  - `LineInput.reward?: boolean` and `PricedLine.reward?: true`.
  - `priceLine` with `reward`: quantity must be 1, else `OrderError('A free drink is one drink.')`. The base is 0, modifiers keep their prices, and the line carries `reward: true`.
  - `priceLines` allows at most one reward line, else `OrderError('One free drink per order.')`.
- `sync.ts`:
  - `SyncEventKind` gains `'customer.linked' | 'customer.unlinked' | 'stamp.added' | 'reward.used'`, with `SyncEvent` members `{ orderId: string; publicCode: string }`, `{ orderId: string }`, `{ orderId: string; stampId: string }` and `{ claimId: string; orderId: string }`.
  - `type TillCustomer = { code: string; catName: string | null; stampMode: StampMode; stamps: number; fullCards: number }`. `code` is formatted. `catName` is always null until Plan 8.
  - `PullState.customers?: TillCustomer[]`, where absent means an API from before this plan.
  - `OnlineQueueOrder.card?: 'stamp' | 'stamped' | 'paper' | null`. `isOnlineQueueOrder` accepts the field missing or one of those values.
  - `repriceCounterOrder`: a line with `reward` matches when its base is 0 and its modifiers match the snapshot.
  - `eventSummary` gains `customer.linked` → `Customer added: KC-…` (from the payload's code), `customer.unlinked` → `Customer removed`, `stamp.added` → `Stamp`, `reward.used` → `Free drink used`.
  - `type PaperStamp = { id; orderId; ticket: string; customerId; customerCode: string; displayName: string; customerMode: StampMode; stampedAt: string; deviceName: string | null; staffName: string | null }`.
  - `AttentionView.stamps: PaperStamp[]`.

- [ ] **Step 1: Write `loyalty.test.ts`:**
  - **"the check character catching typos"** (spec must-have):
    - for 200 codes from a seeded generator, **every** single-symbol substitution (8 × 30 per position, all 9 positions) gives `normalisePublicCode` → null;
    - every swap of two neighbouring, different symbols → null;
    - the code itself, written as `kc 7f3-k9q xam` style input, normalises back.
  - Symbols outside the alphabet (`0`, `O`, `1`, `I`, `L`) → null; a wrong length → null.
  - `formatPublicCode` makes 3 groups of 3 behind `KC-`.
  - `orderPoints`:
    - ₱245 → 24;
    - ₱9.99 → 0;
    - subtotal ₱300, discount ₱30, free line ₱40 → 23;
    - a free line larger than what remains → 0;
    - the result is never negative.
  - `hasDrink([{kind:'food'}])` → false; `[{kind:'food'},{kind:'drink'}]` → true; `[{kind:null}]` → true.
- [ ] **Step 2: Extend `price-order.test.ts`** (or `core.test.ts`, wherever `priceLine` is tested):
  - a reward Latte L with Oat (₱35): base 0, line total 3500, `reward: true`;
  - a reward line with quantity 2 → the message;
  - two reward lines → the message.
- [ ] **Step 3: Extend `sync.test.ts`:**
  - `repriceCounterOrder` with a reward line at base 0 → `matches`;
  - the same line at the full base with `reward` → mismatch;
  - `isOnlineQueueOrder` with `card: 'stamp'` → true, with `card: 'gold'` → false, and without `card` → true;
  - `eventSummary` for the four kinds and a garbled payload.
- [ ] **Step 4: Run** `npm test -w @kennko/core` and confirm it FAILS.
- [ ] **Step 5: Implement.** Export everything from `index.ts`.
- [ ] **Step 6: Run** root `npm test` + `npm run typecheck` and confirm they PASS. The till and API still compile: the new fields are optional.
- [ ] **Step 7: Commit** `feat(core): public codes with a check symbol, points, drink check, free-drink line, loyalty sync kinds`

---

### Task 2: Migration 0019 — customers, cards, stamps, ledger, owns_order after sign-up

**Files:**
- Create: `apps/api/supabase/migrations/0019_customers_and_stamps.sql`, `apps/api/test/loyalty-schema.test.ts`
- Modify:
  - `apps/api/test/supabase-stubs.sql`: `auth.users.created_at timestamptz not null default now()`;
  - `apps/api/test/migrations.test.ts`, if it lists files.

**Interfaces (the SQL):**
- **`customers`:**
  - `id uuid primary key references auth.users(id) on delete cascade`;
  - `public_code text not null unique check (public_code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{9}$')`;
  - `display_name text not null check (char_length(display_name) between 1 and 40)`;
  - `stamp_mode text not null default 'none' check (stamp_mode in ('none','digital','paper'))`;
  - `stamp_mode_set_by uuid references staff(id)`, `stamp_mode_set_at timestamptz`;
  - `age_confirmed_at timestamptz not null`, `privacy_accepted_at timestamptz not null`;
  - `privacy_version text not null check (char_length(privacy_version) between 1 and 20)`;
  - `created_at timestamptz not null`.
  - Index `customers_display_name_idx on customers (lower(display_name))`.
- **`stamp_cards`:**
  - `id uuid primary key default gen_random_uuid()`;
  - `customer_id uuid not null references customers(id) on delete cascade`;
  - `started_at timestamptz not null`, `filled_at timestamptz`, `claimed_at timestamptz`;
  - `claim_id uuid unique`, `claimed_order_id uuid references orders(id)`, `claimed_by_staff uuid references staff(id)`, `claimed_device_id uuid references devices(id)`;
  - check `claimed_at is null or filled_at is not null`;
  - check `(claimed_at is null) = (claim_id is null)`.
  - Unique index `stamp_cards_one_open on stamp_cards (customer_id) where filled_at is null` (Ruling 5).
- **`stamps`:**
  - `id uuid primary key` (the till's id);
  - `customer_id uuid not null references customers(id) on delete cascade`;
  - `card_id uuid references stamp_cards(id) on delete cascade`;
  - `order_id uuid not null references orders(id)`;
  - `stamped_by_staff uuid references staff(id)`, `device_id uuid references devices(id)`;
  - `stamped_at timestamptz not null`, `received_at timestamptz not null`;
  - `flags text[] not null default '{}'`;
  - `resolved_at timestamptz`, `resolved_by uuid references staff(id)`;
  - check `card_id is not null or 'mode_was_paper' = any(flags)`.
  - Unique index `stamps_one_per_order on stamps (order_id) where not ('forgiven' = any(flags))` (Ruling 7). Index `stamps_card_idx (card_id)`.
- **`points_ledger`:**
  - `id uuid primary key default gen_random_uuid()`;
  - `customer_id uuid not null references customers(id) on delete cascade`;
  - `delta int not null check (delta <> 0)`;
  - `reason text not null check (reason in ('order','order_reversed','cosmetic','adjustment'))`;
  - `order_id uuid references orders(id)`, `cosmetic_id uuid` (no FK: Plan 8 adds it);
  - `note text check (char_length(note) between 1 and 200)`;
  - `created_at timestamptz not null`, `created_by_staff uuid references staff(id)`;
  - check `(reason in ('order','order_reversed')) = (order_id is not null)`;
  - check `reason <> 'adjustment' or (created_by_staff is not null and note is not null)`.
  - Unique index `points_once_per_order on points_ledger (order_id, reason) where order_id is not null`. Index `(customer_id, created_at desc)`.
- **`rate_limits`:** `key text`, `window_start timestamptz`, `hits int not null`, `primary key (key, window_start)`.
- **`orders`:** add `customer_id uuid references customers(id) on delete set null`, with index `orders_customer_idx (customer_id) where customer_id is not null`.
- **`order_lines`:** add `is_reward boolean not null default false`.
- **`sync_events`:** drop and re-add the kind check with the four new kinds.
- **`owns_order`** (Ruling 1): `create function public.owns_order(order_user_id uuid, order_email text, order_created_at timestamptz)`. Same body as 0009, except the email branch also requires `u.created_at <= order_created_at`.
  - Drop and recreate the three customer policies, on `orders`, `order_lines` and `order_line_options`, with the third argument (the joined order's `created_at`).
  - Then `drop function public.owns_order(uuid, text)`.
  - Grants as in 0009.
- **RLS:**
  - enable it on the five new tables;
  - `revoke all … from anon, authenticated`;
  - `grant select, insert, update, delete` on the five tables `to kennko_api`, with one `to kennko_api` policy per command.

- [ ] **Step 1: Write `loyalty-schema.test.ts`** (PGlite, migrations applied):
  - a second open card for one customer fails with `stamp_cards_one_open`; a filled card plus a new open one succeeds;
  - a second stamp on one order fails with `stamps_one_per_order`; it succeeds when the first has the `forgiven` flag;
  - a stamp with `card_id` null and no `mode_was_paper` flag fails;
  - a second `('order', order X)` ledger row fails;
  - an `adjustment` without `note` fails;
  - `delta = 0` fails;
  - a public code with `O` fails;
  - deleting the `auth.users` row cascades to the customer, cards, stamps and ledger, and sets `orders.customer_id` to null;
  - `has_table_privilege('kennko_api', t, 'DELETE')` is true for the five new tables and false for `orders`, `payments`, `sync_events` and `shifts`;
  - `anon` and `authenticated` have no SELECT on any of the five;
  - the `sync_events` kind check accepts `stamp.added`;
  - **owns_order:** as `authenticated` (`asUser`), a confirmed user created on 2026-11-10 sees their own order, and a guest order under the same email from 2026-11-12, but not one from 2026-11-01.
- [ ] **Step 2: Run** `npm test -w @kennko/api -- loyalty-schema` and confirm it FAILS.
- [ ] **Step 3: Write the migration** and the stub column.
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` and confirm they PASS (`orders-schema` and `staff-schema` unchanged).
- [ ] **Step 5: Commit** `feat(api): migration 0019 — customers, stamp cards, stamps, points ledger, owns_order after sign-up`

---

### Task 3: API loyalty module — lock, cards, stamps, points

**Files:**
- Create: `apps/api/src/loyalty/cards.ts`, `apps/api/src/loyalty/points.ts`, `apps/api/src/loyalty/customers.ts`, `apps/api/test/loyalty.test.ts`

**Interfaces** (all take a `Tx`, never open a transaction, and hold the customer lock through `lockCustomer`):
- `customers.ts`:
  - `lockCustomer(tx, id): Promise<{ id; stamp_mode: StampMode } | null>` (`for update`);
  - `customerByCode(tx, bare)`;
  - `tillCustomer(tx, id): Promise<TillCustomer>`, the only function that builds the till's view;
  - `cardSummary(tx, id): Promise<{ stamps: { stampedAt: string }[]; fullCards: number }>`.
- `cards.ts`:
  - `repackCards(tx, customerId, now)` (Ruling 6). Full cards are updated before the partial one, so the open-card index never sees two.
  - `addStamp(tx, { customerId, stampId, orderId, staffId, deviceId, stampedAt, now }): Promise<'added' | 'already_recorded' | 'already_stamped' | 'paper'>`:
    - same id → `already_recorded`;
    - another live stamp on the order → `already_stamped`;
    - mode `paper` → the stamp is inserted with no card and the `mode_was_paper` flag, and the answer is `paper`;
    - mode `none` → set to `digital`;
    - otherwise insert it on the open card (created if missing), then repack.
  - `removeOrderStamp(tx, orderId, now): Promise<'removed' | 'forgiven' | 'none'>` (Ruling 7).
  - `claimFreeDrink(tx, { customerId, claimId, staffId, deviceId, now }): Promise<'claimed' | 'already_claimed' | 'none_full'>`:
    - same `claimId` → `already_claimed`;
    - otherwise `update stamp_cards set claimed_at, claim_id, … where id = (oldest filled and unclaimed) and claimed_at is null returning id`.
  - `unclaim(tx, { cardId? , claimId?, orderId? }, now)` clears the claim and repacks.
- `points.ts`:
  - `creditOrderPoints(tx, orderId, now)` reads the order (`customer_id`, `payment_status`, `prep_status`, subtotal, discount) and the sum of its `is_reward` lines. Unless it is linked, `paid` and not cancelled with points > 0, it does nothing. Otherwise `insert … on conflict do nothing` (reason `order`).
  - `reverseOrderPoints(tx, orderId, now)`: when an `order` row exists and no `order_reversed` row, insert `-delta`.
  - `dropOrderPoints(tx, orderId, customerId)` (unlink, Ruling 8).
  - `adjustPoints(tx, { customerId, delta, note, staffId, now })`.
  - `balance(tx, customerId): Promise<number>`.

- [ ] **Step 1: Write `loyalty.test.ts`** (PGlite, a seeded customer and counter orders inserted directly):
  - **"one stamp per order"** (spec must-have): `addStamp` twice with the same id → `already_recorded`; with another id → `already_stamped`; one stamp row.
  - **"a 9th stamp rolling onto a fresh card"** (spec must-have):
    - 8 stamps → card A `filled_at` set;
    - the 9th → card B, open, holding 1;
    - A still unclaimed;
    - 17 stamps → 2 full cards and 1 stamp on the third.
  - **Removal:**
    - removing stamp 3 of 9 → A holds 8 (B's stamp moved up), B is deleted, A is still full;
    - removing a stamp on a claimed card → `forgiven`, the row stays and the counts are unchanged.
  - **Paper:** mode `paper` → `addStamp` gives `paper`, `card_id` null, flag `mode_was_paper`, no card created.
  - **Claim:**
    - two full cards → two claims with different ids take the oldest first;
    - a third → `none_full`;
    - the same `claimId` again → `already_claimed`;
    - `unclaim` → the card is unclaimed and still full.
  - **"reversal after the points were spent"** (spec must-have):
    1. credit 24 points;
    2. a seeded `cosmetic` row of −20 (plain insert, as Plan 8's buy would write it);
    3. `reverseOrderPoints` → an `order_reversed` row of −24, balance −20;
    4. a second reversal writes nothing.
  - **Points rules:**
    - an unpaid or cancelled order, or one with no customer → no credit;
    - a second credit → still one row;
    - ₱300 with a ₱40 free line → 26 points;
    - an online order's delivery fee earns nothing.
  - `tillCustomer` keys equal `['catName','code','fullCards','stampMode','stamps']`, with `catName` null and `code` formatted.
- [ ] **Step 2: Run** `npm test -w @kennko/api -- loyalty.test` and confirm it FAILS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` and confirm they PASS.
- [ ] **Step 5: Commit** `feat(api): loyalty module — customer lock, card repacking, stamps, claims, points ledger`

---

### Task 4: API — join, account, deletion, history after sign-up, checkout link

**Files:**
- Create: `apps/api/test/me-account.test.ts`
- Modify:
  - `apps/api/src/routes/me.ts`: `GET /`, `POST /join`, `PATCH /`, `DELETE /`;
  - `apps/api/src/auth-admin.ts`: `getUser` returns `createdAt` and `name`; `deleteUser` treats 404 as done;
  - `apps/api/src/orders/read.ts`: `readHistory` takes `createdAt`;
  - `apps/api/src/orders/create.ts`: sets `customer_id`;
  - `apps/api/test/fakes.ts`, `apps/api/test/auth-admin.test.ts`, `apps/api/test/orders-read.test.ts`, `apps/api/test/sync-as-api-role.test.ts`;
  - `packages/core/src/views.ts`: `MeView`.

**Interfaces:**
- `AuthAdmin.getUser` → `{ email; emailConfirmed; createdAt: string | null; name: string | null } | null`. `name` comes from `user_metadata.full_name ?? name`.
- `type MeView = { customer: { publicCode: string; displayName: string; joinedAt: string; stampMode: StampMode; card: { stamps: { stampedAt: string }[]; fullCards: number } | null; points: number } | null }`:
  - `card` is null on paper;
  - `publicCode` is formatted;
  - the email is never echoed (the website already has it).
- Routes (`requireUser`):
  - `GET /v1/me` → `MeView`, `no-store`.
  - `AppDeps.publicCode?: () => string` (like `orderCode`; defaults to `makePublicCode(crypto.randomInt)`), so tests can force clashes.
  - `POST /v1/me/join` `{ ageConfirmed: true, privacyVersion: string 1..20, displayName?: 1..40 }`:
    - creates the row with `deps.publicCode()`, retried up to 5 times on a unique clash;
    - `display_name` = given ?? `getUser().name` ?? the email's local part, trimmed and cut to 40;
    - already joined → 200 with the same view (idempotent);
    - `ageConfirmed` not `true` → 400.
  - `PATCH /v1/me` `{ displayName }` → 404 `NOT_JOINED` when there is no row.
  - `DELETE /v1/me` `{ confirm: 'DELETE' }` (Ruling 16) → `{ deleted: true }`:
    - staff → 409 `IS_STAFF`;
    - `deleteUser` throws → 502 `AUTH_DELETE_FAILED`;
    - a missing body → 400.
- `GET /v1/me/orders`: the email branch adds `and created_at >= ${createdAt}`, and is skipped when `createdAt` is null.
- `createOrder` (online): `customer_id = (select id from customers where id = ${userId})` when signed in (Ruling 9).

- [ ] **Step 1: Write `me-account.test.ts`:**
  - **Join:**
    - `GET` before joining → `{ customer: null }`;
    - join → `publicCode` matches `/^KC-[2-9A-HJKMNP-Z]{3}(-[2-9A-HJKMNP-Z]{3}){2}$/` and normalises valid;
    - `stampMode 'none'`, `card` with 0 stamps, `points 0`;
    - a second join → the same code;
    - without `ageConfirmed` → 400;
    - forced code clashes (the injected generator returns a taken code twice) → a third code is used;
    - the display name defaults to the fake's `name`.
  - **PATCH:** a 41-character name → 400.
  - **"account deletion leaving no row that points to the person"** (spec must-have). Seed: a customer with 2 cards, stamps, ledger rows, one counter order and one online order linked (`customer_id`, `customer_user_id`), and a push subscription. After `DELETE`:
    - no row in `customers`, `stamp_cards`, `stamps` or `points_ledger` with that customer id;
    - no `orders` row with `customer_id` or `customer_user_id` = id;
    - no `push_subscriptions` row for the user;
    - `authAdmin.deleteUser` called once with the id;
    - the orders themselves still exist with their totals.
  - **Deletion errors:**
    - `deleteUser` throwing → 502, and the customer rows are already gone;
    - a retry → 200;
    - a staff user → 409 `IS_STAFF` and nothing deleted.
  - **"Re-signup never re-attaches"** (Ruling 1):
    - a guest order under `ana@x.test` placed before the fake user's `createdAt` → not in `/v1/me/orders`;
    - one placed after → listed with `claimedByEmail: true`.
  - **Checkout:** a signed-in user with a card → the order has `customer_id`; without a card → null; a guest → null.
- [ ] **Step 2: Update** `orders-read.test.ts` (the fake gains `createdAt` earlier than the seeded guest orders, so the existing cases keep passing) and `auth-admin.test.ts` (`createdAt` and `name` mapped; `deleteUser` 404 resolves).
- [ ] **Step 3: Extend `sync-as-api-role.test.ts`:** `GET /v1/me`, join, `PATCH` and `DELETE` (a second customer) as `kennko_api` → 200.
- [ ] **Step 4: Run** `npm test -w @kennko/api -- me-account orders-read auth-admin` and confirm it FAILS.
- [ ] **Step 5: Implement.**
- [ ] **Step 6: Run** root `npm test` + `npm run typecheck` + `npm run build -w @kennko/api` and confirm they PASS.
- [ ] **Step 7: Commit** `feat(api): Kennko card join, account view, hard delete, history only after sign-up, checkout links the card`

---

### Task 5: API sync — link, unlink, stamp and reward events; points and stamps follow cancels and payments

**Files:**
- Create: `apps/api/src/sync/loyalty-events.ts`, `apps/api/test/sync-loyalty.test.ts`
- Modify:
  - `apps/api/src/sync/schema.ts`: kinds, payloads, the reward refine;
  - `apps/api/src/sync/apply.ts`: handlers, `entityKeys`;
  - `apps/api/src/sync/counter-order.ts`: `is_reward`; `applyCancelled` calls `onOrderCancelled`;
  - `apps/api/src/orders/actions.ts`: `decidePaymentTx` (verified → `creditOrderPoints`); `cancelOrderTx` (→ `onOrderCancelled`);
  - `apps/api/src/attention/read.ts`: `RECEIPT_FLAGS`;
  - `apps/api/test/sync-helpers.ts`: `customerLinked`, `customerUnlinked`, `stampAdded`, `rewardUsed`;
  - `apps/api/test/sync-as-api-role.test.ts`.

**Interfaces:**
- `schema.ts`:
  - `customerLinkedPayload = { orderId: uuid, publicCode: string.refine(normalisePublicCode !== null) }`;
  - `customerUnlinkedPayload = { orderId: uuid }`;
  - `stampAddedPayload = { orderId: uuid, stampId: uuid }`;
  - `rewardUsedPayload = { claimId: uuid, orderId: uuid }`;
  - `pricedLineShape` gains `reward: z.literal(true).optional()`;
  - `orderCreatedPayload.refine`: at most one reward line, and it has quantity 1 (held `invalid: lines: reward`).
- `entityKeys`: the four kinds → `order:<orderId>`, and `waitKeys` is the same.
- `loyalty-events.ts` (handlers with Plan 4's signature; each loads the order `for update`, then locks the customer):
  - `customer.linked`:
    - no order → held `order_unknown`;
    - online order → flagged `online_order`;
    - unknown code → flagged `unknown_customer`;
    - linked to this customer → applied `already_linked`;
    - linked to another → flagged `linked_other`;
    - otherwise set `customer_id`, then `creditOrderPoints`.
  - `customer.unlinked`:
    - no order → held `order_unknown`;
    - not linked → applied `not_linked`;
    - otherwise `removeOrderStamp`, `dropOrderPoints`, clear `customer_id` (Ruling 8).
  - `stamp.added`:
    - no order → held `order_unknown`;
    - no `customer_id` → flagged `not_linked`;
    - cancelled → applied `already_cancelled`;
    - not `paid` → flagged `not_paid`;
    - no drink (`hasDrink` over lines joined to `menu_items` → `menu_categories.kind`) → flagged `no_drink`;
    - otherwise `addStamp`: `paper` → flagged `mode_was_paper`, `already_stamped` → applied `already_stamped`.
    - Allowed on online orders.
  - `reward.used`:
    - no order → held `order_unknown`;
    - no card with that `claim_id` → flagged `unknown_claim`;
    - `claimed_order_id` already another order → flagged `claim_reused`;
    - otherwise set it.
    - If the order is already cancelled → `unclaim` (Ruling 12), applied `already_cancelled`.
- `onOrderCancelled(tx, orderId, now)`: `reverseOrderPoints`, `removeOrderStamp`, `unclaim({ orderId })`. Used by the till void, admin cancel/refund and payment rejection.
- `RECEIPT_FLAGS` gains `unknown_customer`, `linked_other`, `not_linked`, `no_drink`, `unknown_claim`, `claim_reused` (not `mode_was_paper`: Ruling 13).

- [ ] **Step 1: Write `sync-loyalty.test.ts`** (`syncApp`, real pushes, a seeded customer):
  - **Offline batch in till order:** `shift.opened`, `order.created` (₱245), `customer.linked`, `stamp.added` in one push → all applied; `orders.customer_id` set; 24 points; one stamp.
  - **Out of order:** `customer.linked` pushed before its sale → held `order_unknown`; the sale's push applies both; the stamp pushed with it waits, then applies (`waits_for_earlier` → applied).
  - **"one stamp per order"** (Review Focus 1): a second `stamp.added` with a new id → applied `already_stamped`, one row.
  - **"none on food-only orders"** (spec must-have): an online paid order whose only line is a food item, linked at checkout → `stamp.added` flagged `no_drink`, no stamp. A mixed food and drink order → stamped.
  - **Paper (Ruling 13):** customer on paper → `stamp.added` flagged `mode_was_paper`, the stamp stored with no card. `GET /v1/attention` does not list the receipt among `events`, and does list it in `stamps`.
  - **Flagged, never refused:**
    - unknown code (valid check symbol) → flagged `unknown_customer`, then the stamp → flagged `not_linked`;
    - a bad check symbol → held `invalid: payload.publicCode…`, with the receipt kept.
  - **Unlink:** unlink → stamp gone, ledger rows for the order gone, `customer_id` null; relink to customer B and stamp → B has the stamp and the points.
  - **Void:** a linked, stamped sale, then `order.cancelled` → an `order_reversed` row, the stamp removed, cards repacked.
  - **Free drink:**
    1. a card with 8 stamps is claimed through `claimFreeDrink` (claim id K);
    2. `order.created` with a reward line (base 0, Oat ₱35, subtotal ₱180 + ₱35), `customer.linked` and `reward.used K` → `claimed_order_id` set, `is_reward` true on that line, the order not flagged `reprice_mismatch`, points = floor((21500 − 3500)/1000) = 18;
    3. `order.cancelled` → the card is unclaimed and full again (Ruling 12).
  - **Reward rules:**
    - `reward.used` with an unknown claim → flagged `unknown_claim`;
    - two reward lines → held `invalid: …reward`.
  - **Online payment:**
    - an online order linked at checkout, verified through admin's payment-decision route (`decidePayment`) → points credited;
    - refunded through admin's cancel route (`cancelOrder`) → reversed;
    - rejected while pending → no credit, no reversal.
  - Existing `sync-push`, `sync-orders`, `sync-online-prep` and `attention` stay green.
- [ ] **Step 2: Extend `sync-as-api-role.test.ts`:** one push carrying all four kinds, plus a void, as `kennko_api` → no permission errors.
- [ ] **Step 3: Run** `npm test -w @kennko/api -- sync-loyalty` and confirm it FAILS.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** root `npm test` + `npm run typecheck` and confirm they PASS.
- [ ] **Step 6: Commit** `feat(api): counter link, unlink, stamp and free-drink facts through sync; points and stamps follow payments and cancels`

---

### Task 6: API till routes — lookup, claim, release, pull additions, the till allowlist

**Files:**
- Create: `apps/api/src/routes/customers.ts` (till part), `apps/api/src/rate-limit.ts`, `apps/api/test/till-customers.test.ts`
- Modify:
  - `apps/api/src/sync/pull.ts`: `customers`;
  - `apps/api/src/sync/online-orders.ts`: `card`;
  - `apps/api/src/routes/sync.ts`, if the pull's signature needs the device id;
  - `apps/api/src/create-app.ts`: `/v1/customers`, `/v1/stamp-cards`;
  - `apps/api/test/sync-online-pull.test.ts`: the column pin gains `card`;
  - `apps/api/test/sync-as-api-role.test.ts`.

**Interfaces:**
- `rate-limit.ts`: `hit(sql, key, limit, now): Promise<boolean>`. It upserts the `(key, minute)` row, increments, deletes the key's windows older than 10 minutes, and returns `hits <= limit`.
- `GET /v1/customers/by-code/:code` (`requireDevice`):
  - `hit('lookup:'+deviceId, LOOKUPS_PER_MINUTE)` false → 429 `RATE_LIMITED`;
  - `normalisePublicCode` null → 400 `BAD_CODE`;
  - unknown → 404 `UNKNOWN_CUSTOMER`;
  - otherwise `TillCustomer`, `no-store`.
  - Codes in `customer.linked` payloads are compared after `normalisePublicCode` (in JS), never as raw text.
- `POST /v1/stamp-cards/claim` (`requireDevice`) `{ claimId: uuid, code: string, staffId: uuid | null }`:
  - unknown → 404;
  - paper → 409 `PAPER_CARD`;
  - `none_full` → 409 `NO_FREE_DRINK`;
  - `claimed` or `already_claimed` → 200 `{ customer: TillCustomer }`.
  - A `staffId` that matches no staff is stored as null. Runs in `deps.sql.begin` with `lockCustomer`.
- `POST /v1/stamp-cards/release` (`requireDevice`) `{ claimId }` → `{ released: boolean }`. It unclaims only when `claimed_device_id` is this device and `claimed_order_id` is null.
- Pull:
  - `customers` = `tillCustomer` for each distinct customer found by code in this device's `sync_events` of kind `customer.linked`, result `applied`, `received_at >= now − LINKED_RECENT_MS`, at most 50;
  - `onlineOrders[].card`:
    - `'paper'` when the linked customer is on paper;
    - `'stamped'` when the order has a live stamp;
    - `'stamp'` when it is linked and `hasDrink`;
    - null otherwise.

- [ ] **Step 1: Write `till-customers.test.ts`:**
  - **"nothing beyond the allowed fields sent to the till"** (spec must-have). Seed a customer whose display name is `Ana Reyes`, whose auth email is `ana@x.test` and who has 37 points. Then:
    - the lookup's keys equal `['catName','code','fullCards','stampMode','stamps']` exactly;
    - after a push linking that customer, `GET /v1/sync/pull` has `customers[0]` with the same key list;
    - `JSON.stringify(pull)` and `JSON.stringify(lookup)` contain neither `Ana Reyes` nor `ana@x.test`, nor any key named `points`, `balance`, `email`, `displayName`, `name` or `phone` inside `customers`;
    - every `onlineOrders[].card` is one of the four values.
  - **Lookup:**
    - a lower-case code with spaces works;
    - a typo → 400;
    - the 31st lookup in a minute → 429, and the next minute (`now` + 60 s) → 200;
    - no device token → 401;
    - a revoked device → 401.
  - **"one successful claim when two arrive at once"** (spec must-have): a card with 8 stamps, then `Promise.all` of two claims with different `claimId`s → exactly one 200 and one 409 `NO_FREE_DRINK`; one card claimed. (PGlite runs them one after the other. The guarantee on real Postgres comes from the customer row lock plus the conditional update, which Task 3 tests directly.)
  - **Claim rules:**
    - the same `claimId` twice → 200 both times;
    - paper → 409;
    - release → card unclaimed; release after `reward.used` → `released: false`;
    - another device's release → `released: false`.
  - **Pull:**
    - a link received 31 minutes ago is not in `customers`;
    - a deleted customer drops out of `customers` on the next pull;
    - an online order linked at checkout shows `card: 'stamp'`, then `'stamped'` after a pushed `stamp.added`.
- [ ] **Step 2: Extend `sync-as-api-role.test.ts`:** lookup, claim, release and a pull with `customers`, as `kennko_api`.
- [ ] **Step 3: Run** `npm test -w @kennko/api -- till-customers sync-online-pull` and confirm it FAILS.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** root `npm test` + `npm run typecheck` + `npm run build -w @kennko/api` and confirm they PASS.
- [ ] **Step 6: Commit** `feat(api): till customer lookup, free-drink claim and release, pull carries recent customers and online stamp state`

---

### Task 7: API admin — customer lookup, card mode, point adjustments, stamps to check

**Files:**
- Create: `apps/api/src/loyalty/admin.ts`, `apps/api/test/customers-admin.test.ts`
- Modify:
  - `apps/api/src/routes/customers.ts`: staff routes;
  - `apps/api/src/routes/attention.ts` and `apps/api/src/attention/read.ts`: `stamps` and the count;
  - `apps/api/src/create-app.ts`: `/v1/stamps`;
  - `packages/core/src/views.ts`: admin views;
  - `apps/api/test/attention.test.ts`, `apps/api/test/sync-as-api-role.test.ts`.

**Interfaces:**
- `type CustomerListItem = { id; publicCode; displayName; stampMode; stamps: number; fullCards: number; points: number; joinedAt }`.
- `type CustomerDetail = CustomerListItem & { stampModeSetBy: string | null; stampModeSetAt: string | null; cards: { id; startedAt; filledAt; claimedAt; claimedTicket: string | null; stamps: { id; ticket: string; stampedAt; flags: string[] }[] }[]; ledger: { id; delta; reason; ticket: string | null; note: string | null; byName: string | null; createdAt }[]; paperStamps: PaperStamp[] }`:
  - the last 10 cards;
  - the last 50 ledger rows;
  - no email.
- Routes:
  - `GET /v1/customers?q=` (`requireStaff(deps, 'manager')`): `q` that normalises to a code → exact match; otherwise `lower(display_name) like` (escaped) prefix or word match; at most 20; `q` shorter than 2 → `[]`.
  - `GET /v1/customers/:id` (manager) → `CustomerDetail`. A non-uuid → 404.
  - `POST /v1/customers/:id/stamp-mode` (manager) `{ mode: 'digital' | 'paper' }` (Ruling 14) → 409 `FREE_DRINK_WAITING`. Same mode → 200, no change.
  - `POST /v1/customers/:id/points` (owner) `{ delta: int −10000..10000, not 0, note: 1..200 }` → a new ledger row (never an edit), returning the new balance.
  - `GET /v1/stamps/to-check` (manager) → `PaperStamp[]` (no card, not resolved, flag `mode_was_paper`).
  - `POST /v1/stamps/:id/apply` and `/discard` (manager) → 409 `STILL_PAPER` / `NOT_OPEN`, per Ruling 13. Both also set `resolved_at` / `resolved_by` / `resolve_note` (`'Stamp applied'` / `'Stamp discarded'`) on the matching `sync_events` receipt (kind `stamp.added`, `payload->>'stampId' = id`).
- `readAttention('open')` fills `stamps` (manager query); `countAttention` adds their count. `resolved` → `stamps: []`.

- [ ] **Step 1: Write `customers-admin.test.ts`:**
  - **Search:**
    - by formatted code, by bare code, by `ana` → found;
    - `a` → `[]`;
    - `%` matches nothing extra (escaped);
    - a barista → 403;
    - no token → 401.
  - **Detail:**
    - cards with stamps and tickets;
    - ledger newest first with the staff name;
    - `JSON.stringify` contains no email.
  - **Mode:**
    - none → paper → digital; `stamp_mode_set_by` = the manager;
    - with a full unclaimed card, `paper` → 409 `FREE_DRINK_WAITING`;
    - paper → digital resumes the earlier digital stamps;
    - a barista → 403.
  - **Points:**
    - an owner's +50 with a note → balance +50, `reason 'adjustment'`, `created_by_staff` set;
    - −20 → a second row;
    - a manager → 403;
    - `delta: 0` → 400;
    - no note → 400.
  - **Stamps to check:**
    - a paper stamp is listed;
    - apply while still paper → 409 `STILL_PAPER`;
    - switch to digital, then apply → on a card, and the receipt's `resolved_at` set;
    - a second apply → 409 `NOT_OPEN`;
    - discard on another → flag `discarded`, still no card.
  - `attention.test.ts`: `GET /v1/attention` includes `stamps`, and `count` goes up by one per paper stamp and down after apply.
- [ ] **Step 2: Extend `sync-as-api-role.test.ts`** with every route above.
- [ ] **Step 3: Run** `npm test -w @kennko/api -- customers-admin attention` and confirm it FAILS.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** root `npm test` + `npm run typecheck` and confirm they PASS.
- [ ] **Step 6: Commit** `feat(api): admin customer lookup, card mode, point adjustments, stamps to check`

---

### Task 8: Website — email sign-in link, "Get my Kennko card", account page with QR code, deletion

**Files:**
- Create:
  - `apps/web/components/account/EmailSignIn.tsx`, `apps/web/components/account/StampCard.tsx`, `apps/web/components/account/JoinForm.tsx`, `apps/web/components/account/DeleteAccount.tsx`;
  - `apps/web/app/account/me.ts` (load and map `MeView`), `apps/web/app/account/me.test.ts`;
  - `apps/web/app/account/qr.ts` (`qrSvg(text)`), `apps/web/app/account/actions.test.ts`;
  - `apps/web/app/privacy/page.tsx`, `apps/web/lib/privacy.ts` (`PRIVACY_VERSION = '2026-11'`);
  - `apps/web/app/account/account.css`.
- Modify:
  - `apps/web/app/account/page.tsx`: the account page when signed in; it redirects only when `next` is present;
  - `apps/web/app/account/actions.ts`: `joinKennko`, `renameCard`, `deleteAccount`;
  - `apps/web/app/orders/page.tsx`: the guest-order copy (Ruling 1);
  - `apps/web/package.json`: `qrcode`, `@types/qrcode`;
  - `apps/web/CLAUDE.md`: the Customer accounts section.

**Interfaces:**
- `EmailSignIn` (client):
  - `getBrowserClient().auth.signInWithOtp({ email, options: { emailRedirectTo: origin + '/auth/callback?next=' + encode(next), shouldCreateUser: true } })`;
  - states idle, sending, sent ("Check your email for a sign-in link. Open it on this phone or computer."), and error ("We couldn't send the link. Try again in a minute.");
  - a basic email check before sending.

  `/auth/callback` already exchanges the PKCE code: no change.
- `me.ts`:
  - `loadMe(): Promise<MeView | null>` → `userFetch('/v1/me')`. A non-200 throws `Could not load your Kennko card`.
  - `stampCircles(card): { filled: boolean; date: string | null }[]` (always 8; with `fullCards > 0`, all filled, plus a "Free drink ready" flag).
- `actions.ts` (`'use server'`):
  - `joinKennko(form)` requires the `age` checkbox and the `privacy` checkbox, else "Tick both boxes to get your card." Posts `{ ageConfirmed: true, privacyVersion: PRIVACY_VERSION }`, then `revalidatePath('/account')`.
  - `renameCard(name)`.
  - `deleteAccount(confirm)`:
    - `confirm !== 'DELETE'` → "Type DELETE to confirm.";
    - `DELETE /v1/me`; on 200, `signOut()` and `redirect('/?account=deleted')`;
    - 409 `IS_STAFF` → "Staff logins are removed by the owner in admin.";
    - 502 → "Your card is deleted, but the sign-in could not be removed. Try again."
- `/account` page:
  - **Signed out:** Google button, an "or" divider, then `EmailSignIn`.
  - **Signed in, no card:** a "Get my Kennko card" panel (stamp card and points explained in two lines, the two checkboxes, a link to `/privacy`), then links to `/orders` and a quiet "Delete my sign-in" (`DeleteAccount`).
  - **Signed in with a card:**
    - the QR code (`qrSvg(publicCode)`, server-rendered SVG, at least 200 px, white quiet zone) and the typed code below it in large monospace;
    - the stamp card (8 circles with dates, "Free drink ready" in amber), or the paper notice "You're on a paper card. Your stamps are on the card in your wallet.";
    - "Points: N" with "Points will soon dress up your Kennko cat.";
    - the display name, editable;
    - sign out;
    - Delete account (type DELETE).
- `/privacy`: a short draft notice. It covers what is stored (sign-in email, display name, card, stamps, points, orders), what the till sees (code, stamp count, card state), the age 13+ rule, how to delete, and a contact. A `PRIVACY_VERSION` line at the bottom. Julius reviews the text (Task 12).

- [ ] **Step 1: Write the tests** (mock `@/lib/api/client` as in Plan 6):
  - `me.test.ts`:
    - maps a view;
    - `stampCircles` with 3 stamps → 3 filled with dates and 5 empty;
    - with `fullCards: 1` → 8 filled and ready;
    - paper → `card` null;
    - a 500 → throws.
  - `actions.test.ts`:
    - join without the age box → message, no call;
    - with both → posts `{ ageConfirmed: true, privacyVersion: '2026-11' }`;
    - delete without `DELETE` → no call;
    - 200 → `signOut` called and redirect to `/?account=deleted`;
    - 409 `IS_STAFF` and 502 → their messages.
  - `qr.ts`: `qrSvg('KC-7F3-K9Q-XAM')` starts with `<svg` and contains no script.
- [ ] **Step 2: Run** `npm test -w @kennko/web -- account` and confirm it FAILS.
- [ ] **Step 3: Implement.** The sticker style is from `brand/DESIGN.md`: blue `#0055FF` on white, amber only for "Free drink ready", no dark styles.
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` + `KENNKO_API_URL= npm run build -w @kennko/web` and confirm they PASS. Manual check against a local API (deploy gate if Supabase email is not set up locally):
  - sign-in by email link;
  - join;
  - the QR scans with a phone camera to the typed code;
  - delete with a throwaway account;
  - check at 375, 768 and 1440 px.
- [ ] **Step 5: Commit** `feat(web): email sign-in link, Get my Kennko card, account page with QR code and stamp card, account deletion`

---

### Task 9: Website admin — Customers screen and stamps to check

**Files:**
- Create:
  - `apps/web/app/admin/customers/page.tsx`, `apps/web/app/admin/customers/[id]/page.tsx`;
  - `apps/web/app/admin/customers/actions.ts`, `apps/web/app/admin/customers/actions.test.ts`;
  - `apps/web/components/admin/PaperStampRow.tsx`, `apps/web/components/admin/PointsForm.tsx`.
- Modify:
  - `apps/web/components/admin/AdminNav.tsx`: "Customers", `minRole: 'manager'`, after Orders;
  - `apps/web/app/admin/attention/page.tsx`: a "Stamps to check" block using `PaperStampRow`;
  - `apps/web/app/admin/attention/text.ts` and `text.test.ts`: the new reasons;
  - `apps/web/app/admin/admin.css`;
  - `apps/web/CLAUDE.md`: capability rows (lookup, card mode and stamps to check: manager and owner; adjust points: owner).

**Interfaces:**
- `actions.ts` (`'use server'`, `staffFetch`, `revalidatePath` for `/admin/customers` and the detail page, `{ ok } | { ok: false; message }`):
  - `setStampMode(id, mode)`: `FREE_DRINK_WAITING` → "They have a free drink waiting. Claim it at the till first.";
  - `adjustPoints(id, deltaText, note)`: `'+50'`, `'-20'` and `'50'` parse; `0`, decimals or more than 10000 → "Enter whole points, up to 10,000."; an empty note → "Say why.";
  - `applyStamp(id)`: `STILL_PAPER` → "Switch them to the digital card first.";
  - `discardStamp(id)`.
- Pages:
  - `/admin/customers?q=` (`requireManager`):
    - a search box ("Code or name");
    - a results table (code, name, card state, stamps, full cards, points, joined);
    - above it, "Stamps to check" from `GET /v1/stamps/to-check`.
  - `/admin/customers/[id]` (`requireManager`):
    - the header: code, name, joined;
    - card mode with "Switch to paper card" / "Switch to digital card", each with a confirm step;
    - cards, each stamp with its ticket and date, and claimed cards with their ticket;
    - points: the balance and the ledger table; `PointsForm` for the owner only;
    - this customer's stamps to check.
  - Needs a look gains the "Stamps to check" block for owners.
- `reasonText` gains:
  - `unknown_customer` → "Customer code not found (deleted account or typo)";
  - `linked_other` → "Order already belongs to another customer";
  - `not_linked` → "Stamp without a customer on the order";
  - `no_drink` → "Stamp on an order with no drink";
  - `unknown_claim` → "Free drink not found";
  - `claim_reused` → "Free drink used on two orders".

- [ ] **Step 1: Write the tests:**
  - `actions.test.ts`:
    - the parsing cases above;
    - `setStampMode` posts `{ mode: 'paper' }`;
    - a 409 gets its message;
    - a 403 gets "Only the owner can adjust points.";
    - revalidation is called on success.
  - `text.test.ts`: the six reasons.
- [ ] **Step 2: Run** `npm test -w @kennko/web -- customers attention` and confirm it FAILS.
- [ ] **Step 3: Implement** with the existing admin card and table classes. Amber is used only for "Free drink waiting" and the paper pill.
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` + `KENNKO_API_URL= npm run build -w @kennko/web` and confirm they PASS. Manual check at 375, 768, 1024 and 1440 px; tables scroll inside their card at 375 px.
- [ ] **Step 5: Commit** `feat(web): admin customers — lookup, card mode, point adjustments, stamps to check`

---

### Task 10: Till server — link, unlink, stamp, claim at charge, customer cache

**Files:**
- Create: `apps/pos/server/kennko-api.ts`, `apps/pos/test/loyalty.test.ts`
- Modify:
  - `apps/pos/server/store.ts`: columns, tables, methods, `toEvent`;
  - `apps/pos/server/sync.ts`: apply `customers`;
  - `apps/pos/server/index.ts`: routes;
  - `apps/pos/server/backup.ts`: the snapshot also empties `customer_cache`;
  - `apps/pos/test/outbox.test.ts`, `apps/pos/test/sync.test.ts`, `apps/pos/test/wall-feed.test.ts`.

**Interfaces:**
- SQLite:
  - `ADDED_COLUMNS` gains `orders.customer_code text`, `orders.stamp_uid text`, `orders.reward_claim_id text`;
  - `SCHEMA` gains `customer_cache (code text primary key, data text not null, updated_at integer not null)` and `online_stamps (order_id text primary key, stamp_uid text not null, at integer not null)`.
  - `Order` (core) gains `customerCode: string | null`, `stamped: boolean`, `freeDrink: boolean`.
- `store.ts`:
  - `createOrder(menu, input & { customerCode?: string }, now, by, opts?: { rewardClaimId?: string })`:
    - a reward line without `rewardClaimId` → `OrderError('The free drink was not claimed.')`;
    - in the same `tx`, after `order.created`: `customer.linked { publicCode }` when a code is given, and `reward.used { claimId }` when claimed.
  - `prepareOrder(menu, input)`: the pricing and payment checks of `createOrder` without writing, used before a claim.
  - `linkCustomer(id, code, now, by)`:
    - `normalisePublicCode` null → `OrderError('That code has a typo. Check it and try again.')`;
    - the shift is closed or the order voided → refused;
    - already linked → "Remove the customer first.".
  - `unlinkCustomer(id, now, by)`: shift open; clears `customer_code` and `stamp_uid`; outbox `customer.unlinked`.
  - `stampOrder(id, now, by)`:
    - needs `customer_code`, not voided, not stamped;
    - a cached `stampMode: 'paper'` → "On a paper card: stamp their paper card.";
    - writes `stamp_uid = randomUUID()` and outbox `stamp.added`.
  - `stampOnline(orderId, now, by)`:
    - needs the pulled `card === 'stamp'` and no `online_stamps` row;
    - outbox payload `{ orderId, stampId }` with `entity_local_id` null (Plan 5 Ruling 8 exception);
    - the order's `card` shows as `'stamped'` locally until the pull confirms it.
  - `replaceCustomerCache(list: TillCustomer[])`, `cachedCustomer(code)`.
  - `toEvent` fills `orderId` from the order's uid for the three order-bound kinds, and passes the online stamp's stored `orderId` through.
- `kennko-api.ts`: `deviceCall(dataDir, apiUrl, path, init, timeoutMs): Promise<{ kind: 'ok'; body } | { kind: 'refused'; status; code; message } | { kind: 'offline' } | { kind: 'revoked' }>`. It is the till's only direct API call outside the sync loop, and returns `offline` when the till is unpaired.
- Routes (session required, as the order routes):
  - `GET /api/customers/:code`:
    - typo → 400 with the message;
    - online → `{ customer: TillCustomer }`, also written to the cache;
    - offline, 404 from an old API, or 429 → `{ customer: null, code, note }`, where `note` is "Will confirm when back online" (or the rate-limit message).
  - `POST /api/orders` with `reward: { lineIndex, code }` (Ruling 10):
    1. a manager PIN;
    2. `prepareOrder`;
    3. `deviceCall('/v1/stamp-cards/claim', { claimId: randomUUID(), code, staffId: manager.staffId }, 5000)`;
    4. answers:
       - `offline` → "The free drink needs the internet. Charge it normally, or try again when online.";
       - 409 `NO_FREE_DRINK` → "No free drink waiting on this card.";
       - 409 `PAPER_CARD` → "On a paper card: use their paper card.";
    5. `createOrder(..., { rewardClaimId })`; if that throws, call `/v1/stamp-cards/release` best effort, then rethrow.
  - `POST /api/orders/:id/customer` `{ code }`, `POST /api/orders/:id/customer/remove`, `POST /api/orders/:id/stamp`, `POST /api/online/:id/stamp`.
- Pull: when `state.customers` is present, `replaceCustomerCache`; absent → keep (old API). Revoke and forget empty the cache.

- [ ] **Step 1: Write `loyalty.test.ts`** (temp `pos.db`, fake `fetch` for `deviceCall`):
  - **"the check character catching typos" on the till** (spec must-have): `linkCustomer` with one symbol changed → the typo message, and no outbox row, no `customer_code`.
  - **Sale with customer:** `createOrder` with a code → outbox `order.created`, then `customer.linked` with the order's uuid and the bare code. `stampOrder` → `stamp.added`, and a second stamp → refused.
  - **Unlink:** works while the shift is open; after `endShift` → "That order belongs to a till that is already closed."-style message, and no outbox row.
  - **Claim at charge:**
    - claim 200 → the order has a reward line with base 0 and outbox `reward.used`;
    - claim 409 → nothing saved;
    - offline → nothing saved and the internet message;
    - `createOrder` failing after a claim (shift closed in between) → release called once.
  - **Online stamp:** an online order pulled with `card: 'stamp'` → `stampOnline` writes an outbox row with the server id; a second → refused; `card: 'paper'` → refused.
  - **Cache:**
    - a pull with `customers` replaces it;
    - a pull without the key keeps it;
    - revoke empties it;
    - the backup snapshot has no `customer_cache` rows.
  - `wall-feed.test.ts`: with a linked, stamped order, `JSON.stringify(wallSnapshot())` contains no `KC-` code, no `customerCode` and no `stamp` key (Review Focus 3).
- [ ] **Step 2: Run** `npm test -w @kennko/pos -- loyalty outbox sync wall-feed` and confirm it FAILS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` and confirm they PASS.
- [ ] **Step 5: Commit** `feat(pos): link, unlink and stamp customers through the outbox; free drink claimed at charge; customer cache from the pull`

---

### Task 11: Till screens — Add customer (camera or typed), Stamp, Free drink, Stamp at pickup

**Files:**
- Create: `apps/pos/src/components/AddCustomer.tsx`, `apps/pos/src/components/QrScanner.tsx`, `apps/pos/src/loyaltyText.ts`, `apps/pos/test/loyaltyText.test.ts`
- Modify:
  - `apps/pos/src/screens/Sell.tsx`: "Add customer" in the cart, the customer chip, "Make one drink free";
  - `apps/pos/src/screens/Pay.tsx`: manager PIN for a free drink; "Stamp card" on the done screen;
  - `apps/pos/src/screens/Orders.tsx`: Stamp on counter tickets; "Stamp at pickup" on online tickets with `card: 'stamp'`;
  - `apps/pos/src/screens/History.tsx`: add or remove a customer, Stamp, while the shift is open;
  - `apps/pos/src/api.ts`, `apps/pos/src/styles.css`;
  - `apps/pos/package.json`: `jsqr`;
  - `apps/pos/README.md`: a "Kennko cards" section.

**Interfaces:**
- `QrScanner`:
  - `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })`, with frames decoded by `jsqr` every 200 ms;
  - it stops the camera on unmount or on success;
  - it renders nothing, plus the note "Camera works on the secure address (https://…:4443)", when `window.isSecureContext` is false or the camera is denied.
- `AddCustomer` (modal):
  1. the scanner, or a code field with live typing (`KC-` added, grouped in 3s); `normalisePublicCode` shows "Check the code" until valid;
  2. then `GET /api/customers/:code`, which shows `customerLine(customer)` or the offline note;
  3. Confirm attaches the code to the cart (or calls the order's customer route from Orders and History).

  Skip is always one tap.
- `loyaltyText.ts`:
  - `customerLine(c: TillCustomer | null, note?: string)`:
    - `'Card KC-7F3-…-XAM · 5 of 8 stamps'`;
    - `'… · Free drink ready'` when `fullCards > 0`;
    - `'Paper card: stamp their paper card'`;
    - `'Will confirm when back online'`;
  - `stampButtonLabel(order)`: `'Stamp card'`, `'Stamped'`, or null;
  - `onlineCardLabel(card)`: `'Stamp at pickup'`, `'Stamped'`, `'Paper card'`, or null.

  Codes are shown masked (`KC-7F3-…-XAM`) everywhere but the modal.
- Free drink: offered only when the online lookup said `fullCards > 0`. It marks one drink line `reward` (a line with quantity above 1 is split into 1 + the rest). The cart shows "Free drink: base ₱0, add-ons charged". Pay asks for a manager PIN and sends `reward`.

- [ ] **Step 1: Write `loyaltyText.test.ts`:** every label above, masking, and `fullCards: 2` → "2 free drinks ready".
- [ ] **Step 2: Run** `npm test -w @kennko/pos -- loyaltyText` and confirm it FAILS.
- [ ] **Step 3: Implement.** Keep the counter fast:
  - linking never blocks Charge;
  - an offline lookup never waits more than 3 s (`AbortSignal.timeout`);
  - the modal closes on Confirm.

  In the README, explain:
  - scanning needs the https address;
  - typing always works;
  - a free drink needs the internet;
  - paper cards are stamped by hand.
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` + `npm run build -w @kennko/pos` and confirm they PASS. Manual check on a tablet over https:
  1. scan a phone's QR → the stamp count shows;
  2. charge and stamp;
  3. Wi-Fi off: type a code, charge, stamp, Wi-Fi on → admin › Customers shows the stamp;
  4. 8 stamps → Free drink with a manager PIN → ₱0 base;
  5. an online paid order → Stamp at pickup.
- [ ] **Step 5: Commit** `feat(pos): add customer by camera or code, stamp, free drink at charge, stamp at pickup`

---

### Task 12: Deploy checklist

**Files:** `apps/api/README.md`, a "Plan 7" section. Nothing is run by the implementer: Julius applies the migration and deploys.

- [ ] **Step 1:** On the branch tip, run root `npm test`, `npm run typecheck`, `KENNKO_API_URL= npm run build -w @kennko/web`, `npm run build -w @kennko/api` (load `server.js` with dummy env), and `npm run build -w @kennko/pos`.
- [ ] **Step 2: Write the checklist** into the README, in this order:
  1. **Migration** `0019_customers_and_stamps.sql`: dry run first; expect only 0019. Afterwards: `select count(*) from customers` → 0; `\df public.owns_order` shows the 3-argument function only.
  2. **Supabase Auth** (dashboard):
     - Email provider on, with "Confirm email" on;
     - the magic link enabled; redirect URLs include `https://<site>/auth/callback`;
     - the Magic Link email template in Kennko wording;
     - the SMTP sender is the existing Resend one (no new service);
     - raise the email rate limit from the default to about 30 per hour.
  3. **API:** deploy. No new env vars. Smoke checks:
     - `GET /v1/me` without a token → 401;
     - `GET /v1/customers/by-code/KC-AAA-AAA-AAA` without a device token → 401;
     - `GET /v1/stamps/to-check` without a token → 401.
  4. **Website:** deploy (new dependency `qrcode`). Julius reads and approves the `/privacy` text before announcing cards.
  5. **Till** (shop computer):
     - pull, then `deploy\windows\setup.cmd` (installs `jsqr`, builds, restarts);
     - reload every tablet;
     - open the till on the https address once so the camera permission can be granted.
  6. **Live checks:**
     - Sign in with an email link on a phone, get a card, and see the QR code.
     - At the till, scan it, charge a drink, stamp it. Admin › Customers shows 1 stamp, and the points for the price.
     - Wi-Fi off on the till: type the code, charge, stamp. Wi-Fi on: the stamp arrives within a sync.
     - Switch the test customer to paper and stamp again. The stamp shows under Stamps to check (Customers and Needs a look); apply it after switching back.
     - Void a stamped test sale: the stamp and points are reversed.
     - Free drink: on a test card filled by 8 test sales (voided afterwards only once the claim test is done), claim with a manager PIN: base ₱0, add-ons charged. A second claim says "No free drink waiting".
     - Online: a signed-in customer with a card orders. Admin confirms the payment: points credited. The till shows "Stamp at pickup".
     - Delete a throwaway account from its account page, then check in SQL:
       - `select count(*) from orders where customer_user_id = '<id>' or customer_id = '<id>'` → 0;
       - no `customers` row;
       - the user is gone from Supabase Auth.
- [ ] **Step 3: Commit** `docs(api): plan 7 deploy checklist`

## Self-review notes

- **Spec coverage, rollout step 1:**
  - "Get my Kennko card" with age and privacy ✔ (4, 8);
  - email sign-in link ✔ (8, 12);
  - account page with QR code and typed code ✔ (8);
  - account deletion, a hard delete in one transaction ✔ (4);
  - email matching only after `created_at` ✔ (2, 4).
- **Spec coverage, rollout step 2:**
  - counter linking by camera or typed code, with the check symbol ✔ (1, 10, 11);
  - online lookup with a rate limit ✔ (6);
  - offline "will confirm" ✔ (10, 11);
  - unlink until the shift closes ✔ (5, 10);
  - stamp card: one per order, drinks only, 8 per card, 9th rolls over ✔ (3, 5);
  - paper mode and Needs a look ✔ (5, 7, 9);
  - cancel removes or forgives ✔ (3, 5);
  - claim online with a manager PIN, one success ✔ (6, 10);
  - the free line ₱0 with add-ons charged ✔ (1, 5, 10);
  - a void reopens the card ✔ (5);
  - "Stamp at pickup" ✔ (6, 11);
  - points ledger: credit and reversal, negative balance ✔ (3, 5);
  - admin customer lookup, card mode and point adjustments ✔ (7, 9).
- **Must-have tests in scope:**
  - one stamp per order and none on food-only orders (3, 5);
  - 9th stamp (3);
  - two claims at once (3, 6);
  - reversal after spending (3);
  - check character (1, 10);
  - deletion leaving no row (4);
  - the till allowlist (6, plus the wall feed in 10).
  - Purchase refusal, the equipped cosmetic and the wall code belong to Plan 8.
- **Every app keeps working when deployed alone, in order:**
  - the migration is additive: `owns_order` is replaced in one migration, and the old website no longer reads orders through RLS since Plan 6;
  - the new API is additive, and `GET /v1/me/orders` narrows guest matching (Ruling 1, intended);
  - an old till ignores `customers` and `card`;
  - a new till with an old API gets 404 on lookup, shown as "will confirm when back online", and a claim that answers "needs the internet";
  - the website needs the new API first (deploy order in Task 12).
- **Known limits:**
  - Concurrency is exercised on PGlite one request at a time. The claim's safety on Postgres rests on the row lock plus the conditional update.
  - Admin search has no email lookup (Ruling 17).
  - A customer's contact fields on their online orders survive deletion as sales records (Ruling 16).
  - `catName` is null until Plan 8.
- **Deferred to Plan 8:** the starter cat at join (Ruling 2), cosmetics and spending points, `cats`/`visits`/`shop_secrets`, wall check-in and visiting cats, the cosmetic FK on `points_ledger`.
