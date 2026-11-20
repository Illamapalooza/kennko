# Ordering Navigation, E-Receipts and Push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear navigation through the ordering app, an e-receipt (not an official receipt) for every confirmed order, and Web Push notifications for customers' order progress and staff's new orders.

**Architecture:** Navigation is website-only (one shared bar, a step bar inside the existing order flow). Receipts are built by one pure function from the order row and a new single-row `shop_settings` table, rendered as a printable page and inside the HTML confirmation email. Push uses standard VAPID Web Push: the API stores subscriptions, sends after each committed order change, and the site service worker shows and opens notifications; the website subscribes through server actions that forward to the API.

**Tech Stack:** Next.js 16, Hono 4, postgres.js 3, `web-push` 3, PGlite harness, Resend (HTML + text).

**Spec:** `docs/superpowers/specs/2026-11-20-ordering-nav-receipts-push-design.md`

Branch: `feat/ordering-nav-receipts-push`, cut from `feat/backend-plan-2` (Plan 2 is live; its branch merges after Julius's test order).

## Global Constraints

- Money in integer centavos, formatted with `formatPesos()` from `@kennko/core` at render; times shown in `Asia/Manila` (use the existing `formatManilaDateTime` in `apps/web/lib/format/time.ts`).
- `type`, never `interface`. Core imports carry `.ts`; `apps/api/src` relative imports end `.js`.
- Ordering pages and the receipt page use the sticker theme (`apps/web/app/order/order.css`, tokens in `packages/tokens/tokens.css`); admin uses plain core style. 44px tap targets.
- New tables: RLS on; no `anon`/`authenticated` privileges (`revoke all … from anon, authenticated`); `kennko_api` gets exactly the grants listed; text + check for kinds.
- The receipt always shows `THIS IS NOT AN OFFICIAL RECEIPT`.
- Push never fails a request: sends run after the transaction commits, errors are logged, never thrown to the caller.
- Permission prompts only on a button press.
- The API bundle (`apps/api` `npm run build`, esbuild) must keep loading: `web-push` is added to the esbuild `--external` list and to `apps/api` dependencies.
- VAPID subject is `https://kennko.vercel.app` (no personal email).
- Migrations are applied by Julius; never run them.
- Run `npm test` and `npm run typecheck` from the repo root before every commit; web changes also `KENNKO_API_URL= npm run build -w @kennko/web`.

## Review Focus

1. **Receipt totals disagree with the order** (e.g. add-ons double counted, delivery fee missing): the receipt's numbers must be the stored order columns, never recomputed from lines. Test in Task 3.
2. **A receipt or notification for the wrong person:** the public receipt page never shows full name, street address or full reference; a subscription by order code with an unknown code is refused; a staff subscription without a staff token is refused. Tests in Tasks 3 and 5.
3. **A push failure breaks an order action** (push service down, expired subscription): the action still returns success; 404/410 deletes the subscription. Test in Task 5.
4. **Reloading an old checkout link with an empty cart** strands the customer on Details/Pay: they land on Menu with a note. Test in Task 1.
5. **Notifications on iPhone Safari (not installed)**: the button explains Add to Home Screen instead of failing silently. Test in Task 6.

---

### Task 1: Navigation in the ordering app

**Files:**
- Create: `apps/web/components/order/OrderNav.tsx`, `apps/web/components/order/StepBar.tsx`, `apps/web/components/order/nav.ts`, `apps/web/components/order/nav.test.ts`
- Modify: `apps/web/app/order/OrderClient.tsx`, `apps/web/app/order/[code]/page.tsx`, `apps/web/app/orders/page.tsx`, `apps/web/app/account/page.tsx`, `apps/web/app/order/order.css`

**Interfaces:**
- Produces:
  - `type NavPlace = 'menu' | 'orders' | 'account' | 'status' | 'receipt'`
  - `navLinks(place: NavPlace, signedIn: boolean): { label: string; href: string; current: boolean }[]` → exactly `Menu` (`/order`), `My orders` (`/orders` when signed in, else `/account`), and `Sign in` (`/account`) when signed out or the customer's first name (`/orders`) when signed in; `current` true for the matching place.
  - `<OrderNav place signedIn customerName? />` (server-safe component): wordmark linking `/`, the links above, `aria-current="page"` on the current one.
  - `type Step = 'menu' | 'checkout' | 'pay'`; `STEP_LABELS = { menu: 'Menu', checkout: 'Details', pay: 'Pay' }`; `stepState(step: Step, current: Step): 'done' | 'current' | 'todo'`; `backTarget(step: Step): { step: Step; label: string } | null` → checkout → `{ menu, 'Back to menu' }`, pay → `{ checkout, 'Back to details' }`, menu → null.
  - `<StepBar current onGo(step) />`: done steps are buttons, the current one `aria-current="step"`, todo steps plain text.

- [ ] **Step 1: Write `nav.test.ts`:** `navLinks('menu', false)` → labels `['Menu','My orders','Sign in']`, `My orders` href `/account`, Menu current; `navLinks('orders', true, )` with name → last label is the name, My orders current; `stepState('menu','pay')` `'done'`, `('pay','pay')` `'current'`, `('pay','checkout')` `'todo'`; `backTarget('pay')` `{ step:'checkout', label:'Back to details' }`, `backTarget('menu')` null.
- [ ] **Step 2: Run** `npm test -w @kennko/web -- nav` — FAIL.
- [ ] **Step 3: Implement** `nav.ts`, `OrderNav`, `StepBar`. In `OrderClient`: render `OrderNav place="menu"` on every step (it replaces the masthead's sign-in link; keep the masthead's heading and cats on the menu step); render `StepBar` on all three steps; a `‹ {label}` link from `backTarget` at the top of Details and Pay; when the URL says `checkout` or `pay` but the cart is empty, go to `menu` and show `Your cart is empty — pick something first.` once. Done screen actions become **Track this order**, **My orders** (or Sign in), **Order again**; drop the duplicate "Back to the Kennko site" (the wordmark does it). Add `OrderNav` to the status page (`place="status"`, with **My orders** and **Order again** actions at the bottom), `/orders` (`place="orders"`), `/account` (`place="account"`).
- [ ] **Step 4:** Add a test for the empty-cart redirect at the level you can test it (a pure `resolveStep(urlStep, cartCount): { step: Step; note: string | null }` in `nav.ts` is fine). **Run** root tests, typecheck, web build — PASS.
- [ ] **Step 5: Commit** `feat(web): one navigation bar and step bar across the ordering app`

---

### Task 2: Migration 0015 — shop settings and push tables

**Files:**
- Create: `apps/api/supabase/migrations/0015_shop_settings_and_push.sql`, `apps/api/test/push-schema.test.ts`

Schema:

```
shop_settings  id smallint primary key default 1 check (id = 1),
               display_name text not null, registered_name text, tin text,
               address text not null, phone text, facebook_url text,
               receipt_footer text not null default 'Ask for your official receipt at the counter.',
               updated_at timestamptz not null default now()
               seeded: ('Kennko Coffee', null, null, <address from apps/web/components/site/Visit.tsx>,
                        <phone from Visit/Footer if present else null>, <Facebook URL from Footer if present else null>)
push_subscriptions  id uuid pk default gen_random_uuid(), endpoint text not null unique,
                    p256dh text not null, auth text not null,
                    kind text not null check (kind in ('customer','staff')),
                    staff_id uuid references staff(id) on delete cascade,
                    customer_user_id uuid references auth.users(id) on delete cascade,
                    check ((kind = 'staff') = (staff_id is not null)),
                    created_at timestamptz not null default now(), last_used_at timestamptz
push_order_watch    order_id uuid references orders(id) on delete cascade,
                    subscription_id uuid references push_subscriptions(id) on delete cascade,
                    primary key (order_id, subscription_id)
```

Grants and RLS: all three tables RLS on, `revoke all … from anon, authenticated`; `shop_settings` also `grant select … to authenticated` with policy `staff read shop settings` (using `is_active_staff()`) for later admin use; `kennko_api`: `select` on `shop_settings`; `select, insert, update, delete` on `push_subscriptions` and `push_order_watch`, one `to kennko_api using (true) with check (true)` policy per table. The website reads `shop_settings` with its service key.

- [ ] **Step 1: Write `push-schema.test.ts`:** one seeded `shop_settings` row with `display_name 'Kennko Coffee'` and null `registered_name`/`tin`; a second insert fails the `id = 1` check; a `staff` subscription without `staff_id` fails; a duplicate endpoint fails; deleting an order deletes its watch rows; `anon`/`authenticated` hold no privilege on the push tables (`has_table_privilege` over SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER); `set role kennko_api` can insert a subscription and a watch and select shop settings.
- [ ] **Step 2: Run** — FAIL. **Step 3: Write the migration.** **Step 4: Run** root tests + typecheck — PASS.
- [ ] **Step 5: Commit** `feat(api): migration 0015 — shop settings and push subscriptions`

---

### Task 3: Receipt model and printable page

**Files:**
- Create: `apps/web/lib/receipts/receipt.ts`, `apps/web/lib/receipts/receipt.test.ts`, `apps/web/lib/receipts/load.ts`, `apps/web/app/order/[code]/receipt/page.tsx`, `apps/web/app/order/[code]/receipt/receipt.css`
- Modify: `apps/web/app/order/[code]/page.tsx` (link **View receipt** when paid)

**Interfaces:**
- Produces:
  - `type ShopSettings = { displayName: string; registeredName: string | null; tin: string | null; address: string; phone: string | null; facebookUrl: string | null; receiptFooter: string }`
  - `type ReceiptOrder = { orderCode: string; ticket: string; customerName: string; fulfilment: 'pickup' | 'delivery'; deliveryAddress: string | null; deliveryBarangay: string | null; paidAt: string | null; paymentStatus: PaymentStatus; prepStatus: PrepStatus; cancelledAt: string | null; reference: string | null; subtotalCentavos: number; discountCentavos: number; deliveryFeeCentavos: number; totalCentavos: number; lines: { itemName: string; variantLabel: string; quantity: number; unitPriceCentavos: number; lineTotalCentavos: number; options: { name: string; priceCentavos: number }[] }[] }`
  - `type Receipt = { seller: { name: string; registeredName: string | null; tin: string | null; address: string; phone: string | null; facebookUrl: string | null }; title: 'ORDER RECEIPT'; notice: 'THIS IS NOT AN OFFICIAL RECEIPT'; stamp: 'CANCELLED' | 'REFUNDED' | null; orderCode: string; ticket: string; customer: string; fulfilment: string; paidAt: string; reference: string; lines: …; subtotal: number; discount: number; deliveryFee: number; total: number; footer: string }`
  - `buildReceipt(order: ReceiptOrder, settings: ShopSettings, view: 'public' | 'email'): Receipt | null` — null unless the payment was verified at some point (`paymentStatus` `paid` or `refunded`); `public`: customer = first word of the name, fulfilment line shows the barangay for delivery (never the street address), reference masked to `••••` + last 4; `email`: full name, full address, full reference; totals copied from the order columns (never summed from lines); `stamp` `REFUNDED` when payment `refunded`, `CANCELLED` when prep `cancelled` and payment still `paid`, else null; `paidAt` formatted in Manila.
  - `loadReceiptOrder(code: string): Promise<ReceiptOrder | null>` (service-role read: order, lines, options, live payment `reference` and `verified_at` as `paidAt`) and `loadShopSettings(): Promise<ShopSettings>` (the single row; a hard-coded fallback with `display_name 'Kennko Coffee'` if the read fails, logged).
- Page `/order/[code]/receipt`: `OrderNav place="receipt"`; when `buildReceipt(…, 'public')` is null show `This order has no confirmed payment yet.` with a link back to the status page; otherwise the receipt with a **Print or save as PDF** button (`window.print()`), and a print stylesheet that hides the nav and buttons. `noindex`.

- [ ] **Step 1: Write `receipt.test.ts`:** pending payment → null; paid pickup → notice and title exact, totals equal the order's columns even when lines would sum differently (Review Focus 1), reference `••••1234`, customer `Ana` from `Ana Cruz`, no street address; email view → full name, full reference, full address for delivery; refunded → stamp `REFUNDED`; paid then cancelled → `CANCELLED`; null registered name/TIN stay null (the page omits those rows).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** the model, loaders, page and status-page link. **Step 4: Run** root tests, typecheck, web build — PASS.
- [ ] **Step 5: Commit** `feat(web): order receipt page (not an official receipt)`

---

### Task 4: Receipt in the confirmation email

**Files:**
- Modify: `apps/web/lib/email/send.ts`, `apps/web/lib/email/templates.ts`, `apps/web/app/admin/orders/actions.ts` and their tests
- Create: `apps/web/lib/receipts/email.ts`, `apps/web/lib/receipts/email.test.ts`

**Interfaces:**
- Consumes: Task 3 `buildReceipt`, `loadReceiptOrder`, `loadShopSettings`.
- Produces:
  - `sendEmail({ to, subject, text, html? })` — passes `html` to Resend when given.
  - `receiptText(r: Receipt): string` (plain-text block, monospace-friendly, same content) and `receiptHtml(r: Receipt): string` (table layout, inline styles, all dynamic text HTML-escaped).
  - The confirm action's customer email: subject unchanged; body = today's confirmation text followed by `receiptText`, and `html` = a short confirmation paragraph + `receiptHtml` + a link `View or print your receipt: https://kennko.vercel.app/order/<code>/receipt` (base URL from `NEXT_PUBLIC_SITE_URL`, default `https://kennko.vercel.app`). Built with the `email` view. Still inside the existing `notifyCustomer` try/catch.

- [ ] **Step 1: Tests:** `receiptHtml` escapes `<script>` in a customer name and an item name; both renderings contain `THIS IS NOT AN OFFICIAL RECEIPT` and the formatted total; the confirm action sends `html` containing the receipt link (mock `sendEmail`). **Run** — FAIL.
- [ ] **Step 2: Implement.** **Step 3: Run** root tests, typecheck, web build — PASS.
- [ ] **Step 4: Commit** `feat(web): e-receipt in the payment confirmed email`

---

### Task 5: Push in the API

**Files:**
- Create: `apps/api/src/push/send.ts`, `apps/api/src/push/notify.ts`, `apps/api/src/routes/push.ts`, `apps/api/test/push.test.ts`
- Modify: `apps/api/src/config.ts`, `apps/api/src/create-app.ts`, `apps/api/src/main.ts`, `apps/api/src/orders/create.ts`, `apps/api/src/orders/actions.ts`, `apps/api/package.json` (dependency `web-push`, esbuild `--external:web-push`), `apps/api/README.md`

**Interfaces:**
- Produces:
  - `Config` gains optional `vapid: { publicKey: string; privateKey: string; subject: string } | null` from `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (all three or none; none → push disabled, the API still boots).
  - `type PushSender = (sub: { endpoint: string; p256dh: string; auth: string }, payload: PushPayload) => Promise<'sent' | 'gone' | 'failed'>` with `type PushPayload = { title: string; body: string; url: string; tag: string }`; `createPushSender(vapid)` (web-push; HTTP 404/410 → `'gone'`; other errors → `'failed'`, logged); `AppDeps` gains `push: PushSender | null`.
  - `notify.ts`: `notifyOrder(deps, orderId: string, event: OrderPushEvent): Promise<void>` where `type OrderPushEvent = 'paid' | 'preparing' | 'ready' | 'out_for_delivery' | 'completed' | 'problem'` — loads the order's watchers, builds the copy (`W3 · Payment confirmed — we're on it`, `W3 is being prepared`, `W3 is ready for pickup`, `W3 is on its way`, `W3 is complete — enjoy!`, `W3 · There's a problem with your order`; url `/order/<code>`, tag `order-<code>`), sends to each, deletes `'gone'` subscriptions, updates `last_used_at`; and `notifyStaffNewOrder(deps, orderId)` → every staff subscription of an active staff member: `New order W3 · ₱245 — check payment`, url `/admin/orders?tab=check`, tag `new-order`. Both swallow and log every error.
  - Routes: `POST /v1/push/subscriptions` body `{ subscription: { endpoint, keys: { p256dh, auth } }, orderCode?: string }` — with `orderCode` and no staff token: customer subscription (upsert by endpoint), watch that order (unknown code → 404 `NOT_FOUND`), and when `optionalUser` gives a user id, set `customer_user_id`; with a valid staff token (header) and no `orderCode`: staff subscription for that staff member. `DELETE /v1/push/subscriptions` body `{ endpoint }` → removes it (204 either way). `GET /v1/push/public-key` → `{ publicKey }` or 404 when push is disabled. Error bodies `{ code, message, errors }`.
  - Hooks (after commit, not awaited by the response path — use `void` with the internal try/catch): `createOnlineOrder` → for a signed-in customer, insert watches for every subscription with that `customer_user_id`; then `notifyStaffNewOrder`. `decidePayment` verify → `notifyOrder(…, 'paid')`; reject → `'problem'`. `patchOrder` prep change → the matching event. `cancelOrder` → `'problem'`.

- [ ] **Step 1: Write `push.test.ts`** (fake `PushSender` recording calls; `startTestDb()`): subscribe with an order code → 201, watch row exists; unknown code → 404; staff token without order code → staff subscription; neither → 400 `INVALID`; verify payment → one `paid` notification to the watcher with the W number in the title; a sender returning `'gone'` deletes the subscription; a sender that throws → the verify still returns 200 (Review Focus 3); signed-in customer subscribes on order A, then places order B → B is watched; new order → each active staff subscription notified, inactive staff not; push disabled (`push: null`) → actions succeed, `GET /v1/push/public-key` 404.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**; mount `app.route('/v1/push', pushRoutes(deps))`. **Step 4:** Run root tests + typecheck, and `npm run build -w @kennko/api` then load `apps/api/server.js` with dummy env (as in the API README) to prove the bundle imports — PASS.
- [ ] **Step 5: Commit** `feat(api): web push for order updates and staff alerts`

---

### Task 6: Push in the website and service worker

**Files:**
- Create: `apps/web/lib/push/client.ts`, `apps/web/lib/push/client.test.ts`, `apps/web/app/push-actions.ts`, `apps/web/components/order/NotifyButton.tsx`, `apps/web/components/admin/OrderAlertsButton.tsx`
- Modify: `apps/web/lib/pwa/sw-source.ts` (and its test), `apps/web/app/order/OrderClient.tsx` (done screen), `apps/web/app/order/[code]/page.tsx`, `apps/web/app/admin/page.tsx` (Overview), `apps/web/.env.local.example` (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`)

**Interfaces:**
- Consumes: Task 5 routes; `staffFetch`/`apiBase` (`apps/web/lib/api/client.ts`).
- Produces:
  - `pushSupport(env: { hasServiceWorker: boolean; hasPushManager: boolean; isIos: boolean; isStandalone: boolean }): 'ok' | 'ios-needs-install' | 'unsupported'` (pure; iOS not installed → `'ios-needs-install'`).
  - Server actions (`'use server'`, async only): `subscribeToOrder(orderCode: string, subscription: PushSubscriptionJSON): Promise<{ ok: boolean; message?: string }>` (forwards to the API with the signed-in customer's token when present), `subscribeStaffAlerts(subscription)` (via `staffFetch`), `unsubscribePush(endpoint)`.
  - `NotifyButton({ orderCode })`: states `Notify me about this order` → (permission + `pushManager.subscribe` with `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) → `Notifications on · Turn off`; `'ios-needs-install'` → the copy `On iPhone, add Kennko to your Home Screen first (Share → Add to Home Screen), then turn on notifications there.`; `'unsupported'` → renders nothing; permission denied → `Notifications are blocked in your browser settings.` Hidden when the public key env is missing.
  - `OrderAlertsButton`: same mechanics, labels `Turn on order alerts` / `Order alerts on · Turn off`.
  - Service worker: `push` handler shows `title`, `body`, `tag`, icon `/icons/icon-192.png`, data `url`; `notificationclick` focuses an open tab on that URL (or any same-origin tab and navigates it) else `clients.openWindow(url)`. Only same-origin relative URLs are opened.

- [ ] **Step 1: Tests:** `pushSupport` for the four combinations (Review Focus 5); the worker source contains the push and notificationclick handlers and refuses a cross-origin URL (unit-test the helper you extract, e.g. `safeNotificationUrl(url, origin)`); server actions forward the right body and headers (mock `fetch`/`staffFetch`). **Run** — FAIL.
- [ ] **Step 2: Implement**; place `NotifyButton` on the done screen and the status page (not for completed or cancelled orders), `OrderAlertsButton` on the admin Overview. **Step 3: Run** root tests, typecheck, web build — PASS.
- [ ] **Step 4: Commit** `feat(web): order notifications and staff alerts through push`

---

### Task 7: Ship it

- [ ] **Step 1:** Root `npm test` + `npm run typecheck`.
- [ ] **Step 2:** Generate a VAPID key pair locally (`npx web-push generate-vapid-keys --json`, never printed); set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (sensitive), `VAPID_SUBJECT=https://kennko.vercel.app` on `kennko-api` (production), and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` on `kennko` (production).
- [ ] **Step 3:** Julius applies 0015 (`npx supabase db push --remote --dry-run` lists only `0015_shop_settings_and_push.sql`, then without `--dry-run`). It is additive, so order relative to deploys doesn't matter; apply first.
- [ ] **Step 4:** Deploy the API, smoke-test (`/health`, `/v1/menu`, `/v1/push/public-key` 200); deploy the website.
- [ ] **Step 5:** Julius checks on a phone: navigation through Menu → Details → Pay and back; place an order, tap **Notify me**, confirm it in admin → push arrives and the email has the receipt; open `/order/<code>/receipt` and print; turn on **order alerts** on the admin device and place another order → staff push arrives.

## Self-review notes

- Spec coverage: nav bar ✔ (T1), step bar + Back + done/status actions + empty cart ✔ (T1), receipt contents/privacy/stamps/not-official ✔ (T3), email HTML + text + link ✔ (T4), shop settings seeded with blanks ✔ (T2), push audiences/copy/opt-in/iOS/guests per order/signed-in linking ✔ (T5, T6), subscriptions data + RLS ✔ (T2), send after commit + 410 cleanup ✔ (T5), service worker handlers ✔ (T6).
- Deferred by design: shop settings editing UI, SMS/Messenger, till/wall push.
