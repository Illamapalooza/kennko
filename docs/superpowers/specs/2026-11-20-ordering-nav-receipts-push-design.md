# Ordering navigation, e-receipts and push notifications

**Status:** approved by Julius, 2026-11-20. Builds on Backend Plan 2 (unified orders through the API, live since
2026-11-20). Calls Claude made are marked *(Claude's call)*.

## Why

Julius, testing the live ordering app: "I'm too confused where to navigate back and forward." He also wants every
confirmed order to come with an electronic receipt in the confirmation email, and customers (and staff) to be told
about order changes through the installed app instead of having to keep the page open.

## Goals

1. **Always know where you are and how to go back:** one navigation bar on every ordering page, a visible step bar
   in checkout, and clear next steps after ordering.
2. **A proper e-receipt for every confirmed order:** in the "payment confirmed" email and as a printable page.
3. **Push notifications:** customers hear about their order's progress; staff hear about new orders to check.

## Non-goals

- A BIR official receipt (OR/SI). Kennko's BIR registration is still being processed and there is no accredited
  e-receipt system. The receipt is explicitly not an official receipt.
- Notifications by SMS or Messenger. Email stays as today.
- Push for the till or the wall (later plans).
- Redesigning the menu screen itself; this changes navigation around it.

## Anti-goals

- A receipt that could pass for an official receipt. It must say so plainly.
- Asking for notification permission on page load. Only when the person presses a button.
- A notification that leaks order details to someone else's device (subscriptions are tied to an order the person
  just placed, or to a signed-in staff member).
- A failed push or email ever failing an order or a staff action.

## Approaches considered

| Piece | Approach | Verdict |
|---|---|---|
| Navigation | **One shared top bar + step bar + explicit Back on each step** | **Chosen** |
| | Bottom tab bar on phones | Rejected for now: the sticky cart button already lives at the bottom |
| Receipt | **Receipt section in an HTML email + a printable receipt page** | **Chosen** |
| | Server-generated PDF attachment | Rejected: heavy library, the printable page does the same |
| Push | **Standard Web Push (VAPID) sent from `apps/api`** | **Chosen**: free, no vendor |
| | OneSignal / Firebase | Rejected: a third-party service and SDK for what the platform does natively |

## 1. Navigation (`apps/web`, ordering pages)

```
┌──────────────────────────────────────────────┐
│ KENNKO        Menu   My orders   Sign in ▸    │
├──────────────────────────────────────────────┤
│ ① Menu ── ② Review ── ③ Pay                  │
│ ‹ Back to menu                                │
│ …                                             │
│                      [ Continue to payment ]  │
└──────────────────────────────────────────────┘
```

- **One top bar** on `/order`, `/order/<code>`, `/order/<code>/receipt`, `/orders` and `/account`: the Kennko
  wordmark (to the landing page), **Menu** (`/order`), **My orders** (`/orders`, or `/account` when signed out),
  and **Sign in** / the signed-in name. The current place is marked (`aria-current="page"`). It replaces the
  scattered masthead and footer links. Sticker theme, 44px targets.
- **Step bar** inside the order flow: `Menu · Details · Pay` — the three existing steps (`menu`, `checkout`, `pay`)
  relabelled, no new step *(Claude's call: the checkout step holds the cart review plus contact and pickup or
  delivery details, so "Details" names it honestly)*; the current step highlighted, finished steps clickable,
  future steps not. Each step after the first has a **‹ Back to …** link at the top and one primary button at the
  bottom. The steps stay in the URL as today (`?step=`), so the phone's back button moves one step.
- **After ordering** (the done screen) and **on the status page:** three clear actions, **Track this order** (on the
  done screen), **My orders**, **Order again**, plus **Notify me about this order** (section 3).
- **Order history** rows link to the status page; the status page links to the receipt once paid.
- An empty cart on Review or Pay (e.g. a reloaded old link) sends you back to Menu with a short note
  *(Claude's call)*.

## 2. E-receipt

- **When:** every order whose payment is confirmed. The receipt is part of the "payment confirmed" email (which
  becomes HTML with a plain-text fallback), and a page at `/order/<code>/receipt` that anyone with the order code
  can open, print or save as PDF (browser print, with a print stylesheet).
- **Contents, top to bottom:**
  - Kennko Coffee, address, phone, Facebook page; **registered business name and TIN only when set** (blank now).
  - Title **ORDER RECEIPT** and, prominently, **THIS IS NOT AN OFFICIAL RECEIPT**.
  - Order code, ticket (W number), date and time of payment confirmation in Manila, pickup or delivery (with the
    delivery address), customer name.
  - Lines: quantity × item, size label, add-ons with prices, line total.
  - Subtotal, discount (if any), delivery fee, **total**; "Paid via GCash", reference number.
  - Footer note from shop settings (e.g. "Ask for your official receipt at the counter").
- **Seller details live in one row of a new `shop_settings` table** (the spec's single-row table): `display_name`,
  `registered_name`, `tin`, `address`, `phone`, `facebook_url`, `receipt_footer`. Owner-editable later; seeded with
  today's values from the landing page; `registered_name` and `tin` null until BIR registration is done
  *(Claude's call: editing UI is a follow-up; values are seeded by the migration and changed in Supabase for now)*.
- **Who sees what** *(Claude's call)*: the order code is the only key to the receipt page, as to the status page, so
  the page shows no more personal data than the status page does today: the customer's **first name only**, the
  delivery **barangay** (not the street address) and the GCash reference **masked to its last 4 characters**. The
  emailed receipt, which only reaches the customer's inbox, shows the full name, full delivery address and full
  reference. New order codes are `KNK-` + 6 characters (about 190 million combinations), which keeps guessing
  impractical.
- **Not shown on a receipt that is not paid:** the page answers "This order has no confirmed payment yet" for
  unpaid, rejected or cancelled-before-payment orders. A paid order later cancelled shows the receipt with a
  **REFUNDED** / **CANCELLED** stamp *(Claude's call)*.
- Money formatted with `formatPesos()`; times in Asia/Manila.

## 3. Push notifications

- **Standard Web Push** with VAPID keys. The public key is shared with the browser; the private key lives only in
  the API's environment. Sending uses the `web-push` library from `apps/api`.
- **Who gets what:**

  | Audience | When | Notification | Opens |
  |---|---|---|---|
  | Customer | payment confirmed | "W3 · Payment confirmed — we're on it" | `/order/<code>` |
  | Customer | preparing / ready / out for delivery / completed | "W3 is ready for pickup" etc. | `/order/<code>` |
  | Customer | payment rejected / order cancelled | "W3 · There's a problem with your order" | `/order/<code>` |
  | Staff | new online order (awaiting GCash check) | "New order W3 · ₱245 — check payment" | `/admin/orders?tab=check` |

- **Customer opt-in:** a **Notify me about this order** button on the done screen and the status page. It asks for
  permission only when pressed, then subscribes that device to that order (works for guests). **Guests are per order only**: each new order needs its
  own tap, because nothing ties a guest's device to their next order without tracking it. **A signed-in customer's
  subscription is also linked to their account**: when the API creates a later order for the same account, it adds a
  watch for every subscription on that account, so those orders notify without another tap *(Claude's call)*. The button shows
  "Notifications on" once subscribed, and offers to turn them off.
- **Staff opt-in:** a **Turn on order alerts** button on the admin Overview, per device, for any active staff.
- **iPhone:** Web Push works only when the site is added to the Home Screen (iOS 16.4+). On an iPhone browser tab the
  button explains: "On iPhone, add Kennko to your Home Screen first (Share → Add to Home Screen), then turn on
  notifications there." Android and desktop work in the browser.
- **Data:** `push_subscriptions` (endpoint unique, keys, `kind` customer | staff, `staff_id`, `customer_user_id`,
  created/last-used) and `push_order_watch` (order ↔ subscription). RLS on, no `anon`/`authenticated` access; the API
  (`kennko_api`) reads and writes them.
- **API:** `POST /v1/push/subscriptions` (body: the browser subscription plus `orderCode` for a customer — knowing
  the order code is the proof, as for the status page — or a staff token for staff), `DELETE` to turn off.
  Sending happens **after** the database transaction commits, never inside it, and never fails the request; a push
  service answer of 404/410 deletes that subscription.
- **Service worker:** the site worker (`/sw.js`) gains `push` and `notificationclick` handlers (show the
  notification; on click focus an open tab or open the URL). No caching rules change.

## Constraints

- Money in integer centavos, formatted with `formatPesos()` at render. `type` not `interface`.
- Brand: sticker theme for the ordering pages and the receipt page; plain core style for admin.
- Text + check for new kind columns; RLS on every new table.
- Migrations are applied by Julius (`supabase db push`); Claude never runs them.
- The API bundle (Ruling P9) must keep working: new runtime dependencies are either bundled or listed as external
  and installed.

## Left to the builder

- Component structure; the step bar's exact look within the sticker theme.
- HTML email markup (inline styles, table layout for email clients) as long as the plain-text fallback carries the
  same receipt.
- Notification copy beyond the examples above, keeping the W number first.
- Tests: step navigation and Back; receipt totals equal the order's stored totals; "not an official receipt" always
  present; receipt hidden for unpaid orders; subscription by order code rejects an unknown code; sends happen after
  commit and a failing push never fails the action; 410 removes the subscription.
