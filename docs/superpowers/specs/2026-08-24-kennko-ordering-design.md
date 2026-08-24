# Kennko Online Ordering & Admin — Design Spec

**Date:** 2026-08-24
**Status:** Draft for review
**Author:** Brainstormed with Kenn Baliling (owner)

---

## 1. Problem

Kennko Coffee has a static marketing site and no way to take orders online.
Customers who want a drink ready on arrival have to call `0930 599 2729` or
message Facebook, and staff track those requests by memory. There is no record
of what was ordered, and no way to update the menu or its prices without
editing HTML by hand.

This spec covers a customer-facing pre-order flow paid by GCash, staff
verification of those payments, and a role-gated admin for orders and menu
management.

## 2. Goals

1. A guest customer -- no account, no signup -- can browse the live menu, build
   an order, choose **pickup or delivery**, pay by GCash, and submit proof of
   payment. Name, email, and phone are always required; a delivery address is
   required for delivery and not asked for on pickup.
2. Staff are notified of every new order by email and in the admin.
3. Staff verify the GCash payment against a submitted reference number and
   receipt screenshot before any drink is made.
4. The customer receives a confirmation email once, and only once, staff
   confirm payment.
5. The owner can edit the menu — items, prices, availability, and product
   photos — without a developer or a redeploy.
6. Every surface works on phone, tablet, and desktop. Baristas will verify
   payments on a phone behind the counter; that is a primary use case, not an
   afterthought.

## 3. Non-goals

- **Rider dispatch and tracking.** Delivery is offered, but the system does not assign riders, track them, or show the customer a live map. Staff hand the order to whoever is delivering and mark it out for delivery.
- **A real payment gateway.** No merchant onboarding, webhooks, refunds, or
  card handling. Payment is a static GCash QR settled out-of-band; the system
  records a *claim* of payment and a human verifies it.
- **Customer accounts.** Ordering is guest-only. No signup, login, saved cards,
  or order history for customers.
- **Digitising the Perks card.** The loyalty stamp program stays physical.
- **Inventory or stock counts.** An item is either available or not, toggled by
  hand.
- **Multi-branch.** Kennko relocated from SM Butuan to CT. Montalban St.; there
  is exactly one location.

## 4. Decisions already made

These were settled during brainstorming and are not open for re-litigation in
review:

| Decision | Choice | Why |
|---|---|---|
| Payment | GCash static QR, pay-before-pickup | No gateway onboarding; standard for PH cafes |
| Proof of payment | Reference number **and** receipt screenshot | A static QR carries no order reference; without proof, orders cannot be matched to money received |
| Verification | Manual, by staff, before confirmation email | Prevents making drinks for unpaid orders |
| Admin access | Per-user accounts with `owner` / `barista` roles | Revoke one person without rotating a shared password; price edits stay attributable |
| Menu editing | Owner only | Baristas should not be able to change prices |
| Framework | Next.js (App Router) + TypeScript on Vercel | Conventional Vercel stack; auth, uploads, and role-gated CRUD are solved problems |
| Data / auth / files | Supabase (Postgres, Auth, Storage) | One service for all three; generous free tier |
| Email | Resend | Simple transactional API, good deliverability |
| Sequencing | Address + Maps shipped separately, first | Already done and deployable independently |
| Fulfilment | Customer chooses pickup or delivery | Both are real ways people buy from Kennko |
| Guest checkout | No customer accounts, ever | Nobody signs up to buy one latte |
| Always required | Name, email, phone | Email carries the confirmation; phone is how staff or a rider reaches them |
| Required for delivery only | Street address and barangay | Asking a pickup customer where they live is friction for no benefit |
| Delivery area and fee | A `delivery_zones` table keyed by barangay | Kenn sets which barangays are served and what each costs, without a developer |
| Visual identity | Existing electric blue `#0055FF` brand | The current site and `BRIEF.md` are canonical; the navy/serif menu graphic is **not** a design reference |
| `brand/Kennko Menu.png` | Data source only | Supplies item names, categories, sizes, prices, and modifiers — nothing about how the site should look |
| GCash QR | Placeholder image until the real one is supplied | Unblocks building the flow; ordering stays disabled publicly until swapped |

## 5. Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Next.js App Router on Vercel                              │
│                                                            │
│  /                    public marketing page (ported from   │
│                       the existing index.html)             │
│  /order               menu browse → cart → checkout        │
│  /order/[code]        order status lookup by code          │
│  /admin/login         Supabase email+password sign-in      │
│  /admin/orders        order queue, verify/reject payments  │
│  /admin/menu          menu CRUD (owner only)               │
│  /admin/staff         staff invite + role change (owner)   │
│                                                            │
│  Route handlers / server actions:                          │
│    POST /api/orders            create order                │
│    POST /api/orders/:id/verify confirm or reject payment   │
│    CRUD  menu via server actions, owner-gated              │
└──────────────┬──────────────────────┬──────────────────────┘
               │                      │
      ┌────────▼────────┐    ┌────────▼────────┐
      │    Supabase     │    │     Resend      │
      │  Postgres + RLS │    │  staff alert    │
      │  Auth (staff)   │    │  customer conf. │
      │  Storage:       │    │  rejection      │
      │   payment-proofs│    │                 │
      │   menu-images   │    │                 │
      └─────────────────┘    └─────────────────┘
```

**Why the marketing page gets ported rather than left alone:** the menu must
render from the database on both the public page and the order flow. Leaving a
hardcoded menu in `index.html` guarantees it drifts from the prices customers
are actually charged. The existing visual design carries over intact — same
palette, same type, same layout — as components.

### Rendering strategy

- Public menu and marketing page: server components, revalidated on menu
  mutation via `revalidatePath`. Fast and cacheable, always current.
- Cart: client component, state in `localStorage` so a refresh mid-order does
  not lose the basket.
- Admin: server components for data, client components for interaction.
  Order queue polls every 20s (see §9).

## 6. Data model

All money is stored as **integer centavos** (`price_centavos`). Never floats —
₱95.50 is `9550`. Display formatting happens at the edge.

```sql
-- Staff profiles. Mirrors auth.users; role lives here, not in the JWT app_metadata,
-- so the owner can change a role without the user re-authenticating.
create type staff_role as enum ('owner', 'barista');

create table staff (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null,
  role        staff_role not null default 'barista',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table menu_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  sort_order  int  not null default 0,
  is_active   boolean not null default true
);

create table menu_items (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid not null references menu_categories(id) on delete restrict,
  name          text not null,
  description   text,
  image_path    text,
  is_bestseller boolean not null default false,
  is_available  boolean not null default true,
  sort_order    int not null default 0,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references staff(id)
);

-- Price varies by size, and HOT is its own tier rather than a variant of a
-- size. A missing row means the item is not offered in that size at all:
-- strawberry milk has no HOT row, hojicha has no XL row.
create type drink_size as enum ('M', 'L', 'XL', 'HOT');

create table menu_item_prices (
  menu_item_id   uuid not null references menu_items(id) on delete cascade,
  size           drink_size not null,
  price_centavos int not null check (price_centavos >= 0),
  primary key (menu_item_id, size)
);

-- Add-ons, Milk of Choice, Cream Supreme. Each is a flat surcharge added on
-- top of the size price, independent of size.
create table modifier_groups (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,           -- 'Add-ons' | 'Milk of Choice' | 'Cream Supreme'
  is_multi_select boolean not null,       -- Add-ons yes; Milk of Choice no
  sort_order     int not null default 0
);

create table modifiers (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references modifier_groups(id) on delete cascade,
  name          text not null,
  price_centavos int not null check (price_centavos >= 0),
  is_available  boolean not null default true,
  sort_order    int not null default 0
);

create type fulfilment_method as enum ('pickup', 'delivery');

create type order_status as enum (
  'awaiting_verification',  -- submitted, payment claimed, unchecked
  'confirmed',              -- staff verified payment
  'preparing',
  'ready',                  -- pickup: waiting at the counter
  'out_for_delivery',       -- delivery: handed to whoever is delivering
  'completed',              -- collected or delivered
  'rejected',               -- payment could not be verified
  'cancelled'               -- staff cancelled after confirming
);

-- Which barangays Kennko delivers to, and what each costs. A barangay absent
-- from this table (or inactive) is outside the service area, so the order form
-- refuses it rather than taking money for a delivery nobody will make.
create table delivery_zones (
  id         uuid primary key default gen_random_uuid(),
  barangay   text not null unique,
  fee_centavos int not null check (fee_centavos >= 0),
  is_active  boolean not null default true,
  sort_order int not null default 0
);

create table orders (
  id                 uuid primary key default gen_random_uuid(),
  order_code         text not null unique,   -- human-readable, e.g. "KNK-7F3Q"
  customer_name      text not null,
  customer_phone     text not null,
  customer_email     text not null,          -- required: confirmation target
  fulfilment         fulfilment_method not null,
  -- Delivery only. Enforced by the CHECK below rather than by the form alone,
  -- so a crafted request cannot create a delivery order going nowhere.
  delivery_address   text,
  delivery_barangay  text,
  delivery_zone_id   uuid references delivery_zones(id),
  fulfil_at          timestamptz not null,   -- pickup time, or delivery window start
  status             order_status not null default 'awaiting_verification',
  subtotal_centavos  int not null check (subtotal_centavos >= 0),
  delivery_fee_centavos int not null default 0 check (delivery_fee_centavos >= 0),
  total_centavos     int not null check (total_centavos >= 0),
  gcash_reference    text not null,
  payment_proof_path text not null,          -- Supabase Storage object path
  customer_note      text,
  staff_note         text,                   -- why rejected, etc.
  verified_by        uuid references staff(id),
  verified_at        timestamptz,
  created_at         timestamptz not null default now()
);

-- A delivery order without an address is meaningless; a pickup order with one
-- is a sign the form is confused. Both are rejected at the database.
alter table orders add constraint orders_delivery_needs_address check (
  (fulfilment = 'delivery'
     and delivery_address is not null
     and delivery_barangay is not null
     and delivery_zone_id is not null)
  or
  (fulfilment = 'pickup'
     and delivery_address is null
     and delivery_barangay is null
     and delivery_zone_id is null
     and delivery_fee_centavos = 0)
);

alter table orders add constraint orders_total_is_subtotal_plus_fee check (
  total_centavos = subtotal_centavos + delivery_fee_centavos
);

create index orders_status_created_idx on orders (status, created_at desc);
create index orders_gcash_reference_idx on orders (gcash_reference);

-- Line items snapshot name and price at time of order. Menu edits must never
-- retroactively change what a past order says the customer paid.
create table order_items (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references orders(id) on delete cascade,
  menu_item_id         uuid references menu_items(id) on delete set null,
  name_snapshot        text not null,
  size                 drink_size not null,
  base_price_centavos  int not null,   -- size price at time of order
  quantity             int not null check (quantity > 0),
  line_total_centavos  int not null,   -- (base + sum of modifiers) * quantity
  created_at           timestamptz not null default now()
);

-- Chosen modifiers, snapshotted the same way line items are.
create table order_item_modifiers (
  id                  uuid primary key default gen_random_uuid(),
  order_item_id       uuid not null references order_items(id) on delete cascade,
  modifier_id         uuid references modifiers(id) on delete set null,
  name_snapshot       text not null,
  price_centavos      int not null
);
```

### Why snapshots

`order_items.name_snapshot` and `unit_price_centavos` are duplicated from
`menu_items` deliberately. When the owner raises the price of a Spanish Latte,
yesterday's orders must still show yesterday's price. `menu_item_id` is kept as
a nullable soft reference for reporting, and survives item deletion via
`on delete set null`.

## 7. Order flow

1. **Browse** — `/order` lists available items by category, from the database.
   Unavailable items are shown greyed and unselectable rather than hidden, so
   regulars can see a favourite is temporarily off.
2. **Cart** — size (M/L/XL/HOT, only the sizes that item offers), quantity, and
   any modifiers from the three groups. Line total is
   `(size price + sum of modifier prices) × quantity`. Running total in
   centavos, formatted to ₱.
3. **Fulfilment** — pickup or delivery. Choosing delivery reveals the address
   fields and a barangay picker limited to active `delivery_zones`; the fee for
   the chosen barangay is shown before the customer commits, never revealed
   after payment.
4. **Checkout** — name, phone, email, time, optional note. Name, phone, and
   email are always required. Street address and barangay are required for
   delivery and not shown for pickup. The time is constrained to opening hours
   and a minimum lead time.
5. **Pay** — the GCash QR image is displayed with the exact total to send.
   Until the real QR is supplied this is a clearly-labelled placeholder image at
   `public/gcash-qr-placeholder.png`, marked "SAMPLE — NOT A REAL QR" so it can
   never be mistaken for a live payment target. Swapping it is a one-file change
   and is a precondition of enabling ordering publicly.
6. **Prove** — customer enters the GCash reference number and uploads the
   receipt screenshot.
7. **Submit** — `POST /api/orders` validates, writes `orders` + `order_items`
   in a transaction, stores the upload, and returns the `order_code`.
8. **Confirmation screen** — shows the code and states plainly that the order
   is *not yet confirmed* and that an email follows once payment is checked.
   This wording matters; customers must not read submission as confirmation.
9. **Staff email** fires via Resend to all active staff.
10. **Staff verifies** in admin → customer confirmation email fires.

### Server-side validation

The client total is never trusted. `POST /api/orders` recomputes the subtotal
from current `menu_items` rows, adds the delivery fee looked up from
`delivery_zones`, and rejects with `409 PRICE_CHANGED` if the result disagrees
with the submitted total, prompting the customer to re-check the cart. This
prevents both tampering and the genuine race where the owner edits a price
mid-checkout.

Also enforced server-side:
- Every referenced item exists and `is_available = true`.
- The chosen `size` has a `menu_item_prices` row for that item.
- Every chosen modifier exists, is available, and single-select groups received
  at most one selection.
- `quantity` between 1 and 20 per line.
- `fulfil_at` is in the future and within opening hours.
- For delivery: the barangay matches an active `delivery_zones` row, and the
  fee used is that row's fee — never a value supplied by the client.
- For pickup: no address fields are accepted, and the delivery fee is zero.
- Upload is `image/jpeg|png|webp|heic`, ≤ 8 MB, verified by magic bytes and not
  by the client-supplied MIME type or extension.

## 8. Payment verification

The admin order queue shows `awaiting_verification` orders first, each with the
reference number, a signed URL to the screenshot, the total, and the items.

Staff action is binary:

- **Confirm** — sets `confirmed`, stamps `verified_by`/`verified_at`, sends the
  customer confirmation email.
- **Reject** — sets `rejected`, requires a `staff_note` reason, sends a
  rejection email telling the customer to contact the cafe.

**Duplicate reference detection.** Before rendering, the queue flags any order
whose `gcash_reference` matches an existing non-rejected order. Reusing one
receipt screenshot across several orders is the obvious way to game this flow,
so it is surfaced rather than left for staff to notice.

**Verification is not automated and cannot be.** Nothing in this system talks
to GCash. Staff must open the GCash app and match the reference and amount. The
UI should state that expectation rather than implying the reference was checked.

## 9. Staff notification

Email via Resend to every `staff` row where `is_active`. Subject carries the
order code and total so it is actionable from a lock screen.

**Email alone is insufficient for a busy counter** — it can lag minutes and gets
buried. So the admin order queue also:

- polls every 20 seconds while the tab is open,
- shows an unverified-order count in the page title (`(3) Kennko Admin`),
- plays a short sound on a newly arrived order, defaulting on, toggleable and
  persisted per device.

Email is the backup, the screen is the primary signal.

## 10. Admin

### Authentication

Supabase Auth, email + password. No public signup — the owner creates staff from
`/admin/staff`, which invites by email. Middleware guards every `/admin/*` route;
unauthenticated requests redirect to `/admin/login`.

### Authorisation

| Capability | Barista | Owner |
|---|:--:|:--:|
| View order queue | ✅ | ✅ |
| Confirm / reject payment | ✅ | ✅ |
| Advance order status | ✅ | ✅ |
| View payment screenshots | ✅ | ✅ |
| Create / edit / delete menu items | ❌ | ✅ |
| Change prices | ❌ | ✅ |
| Toggle item availability | ✅ | ✅ |
| Invite staff / change roles | ❌ | ✅ |

Availability toggling is deliberately granted to baristas — running out of
strawberry milk at 3pm is a barista's problem to solve, and gating it behind the
owner means the item stays orderable until he answers his phone.

Role is enforced in **two** places: the UI hides what a barista cannot do, and
Postgres RLS policies reject the write regardless of what the client sends.
UI-only gating is not authorisation.

### Menu management

Owner can create, edit, reorder, and soft-delete items and categories. Editing a
price shows a warning that it affects future orders only. Deleting an item that
appears in past orders is blocked; it can only be marked unavailable, which is
what the owner almost always means anyway.

#### Product images

Each menu item can carry one photo, uploaded from the admin and stored in
Supabase Storage. `menu_items.image_path` holds the object path; the public URL
is derived at render time rather than stored, so moving buckets later does not
require a data migration.

- **Upload** happens inline in the item editor — drag-and-drop or file picker,
  with a live preview before save. On mobile the picker offers the camera, since
  photographing a drink at the counter is the realistic way these get taken.
- **Replacing** an image deletes the previous object in the same transaction as
  the row update. Orphaned images are storage billed forever for nothing.
- **Removing** an image clears `image_path` and deletes the object. Items
  without a photo render a branded placeholder, never a broken image.
- **Path convention:** `menu/{menu_item_id}/{uuid}.{ext}`. The UUID means a
  replacement never collides with a CDN-cached predecessor, so a new photo shows
  up immediately instead of after a cache TTL.
- **Validation:** `image/jpeg|png|webp`, ≤ 5 MB, minimum 400×400px, verified by
  magic bytes server-side. HEIC is rejected with a clear message — iPhones
  produce it by default and a silent failure here would be baffling.
- **Optimisation:** served through `next/image` with explicit `sizes`, so phones
  fetch phone-sized images. A 4MB counter photo shipped raw to a phone on mall
  wifi is the difference between a menu that loads and one that doesn't.
- **Permission:** owner only, same gate as the rest of menu editing. Baristas can
  toggle availability but cannot change how an item is presented.

Seed images: `brand/assets/` already contains product photography for egg
coffee, the coconut series, sea salt caramel oat latte, vanilla milk cloud foam,
and strawberry cloud soda. The last two name drinks no longer on the menu (§12,
question 10), so only the photos matching current items get uploaded during
seeding.

## 11. Security

- **RLS on every table.** Public (anon key) may `insert` into `orders` and
  `order_items` and `select` only `is_active` menu rows. It may never `select`
  from `orders` — order status lookup goes through a server route that takes the
  `order_code` and returns a narrow projection.
- **Two storage buckets with opposite policies**, and the distinction is
  load-bearing:
  - `payment-proofs` — **private**. Payment screenshots are never publicly
    readable. Staff view them through short-lived signed URLs generated
    server-side. A receipt screenshot carries a customer's name and GCash
    details; a public bucket would leak that to anyone who guesses a path.
  - `menu-images` — **public read, owner-only write**. Product photos are
    marketing assets meant to be seen and CDN-cached.

  A single shared bucket is the mistake to avoid here: making it public to serve
  menu photos would expose every customer's payment receipt.
- **Storage write policies are enforced in Postgres**, not just in the upload
  route. `menu-images` writes require the caller's `staff.role = 'owner'`;
  `payment-proofs` accepts anonymous inserts but no reads. A leaked anon key
  must not become an image-hosting service.
- **Service-role key is server-only**, never bundled. All privileged writes go
  through route handlers or server actions.
- **Rate limiting** on order submission — per IP, sliding window. Without it the
  upload endpoint is an open file-storage bill.
- **`order_code` is random**, not sequential, so status lookup cannot be walked.
- **All uploads** — payment proofs and product images alike — are validated by
  magic bytes and stored under a server-generated path; the client-supplied
  filename never reaches storage.

## 12. Open questions

No blockers remain for building. Prices, categories, hot pricing, and the
Specialty Series question were answered by `brand/Kennko Menu.png` (Appendix A).
Visual identity and the GCash QR were settled by the owner: **keep the existing
electric blue brand**, and **ship a labelled placeholder QR** until the real one
arrives.

Precondition for *enabling ordering publicly* (not for building it):

1. **🔴 Real GCash QR image** and the registered account name. The placeholder
   must be replaced and the account name shown, so customers can confirm they
   are paying the right merchant before sending money.

Still worth answering, none blocking:

2. **🟡 Opening hours.** Needed to constrain pickup times. Also: minimum lead
   time (15 min? 30?) and how far ahead an order may be placed (same day only?).
   Until answered, the build assumes 9:00–21:00 daily, 20-minute minimum lead,
   same-day only — all in one config file so changing them is trivial.
3. **🟡 Staff emails.** Which addresses receive new-order alerts, and who is the
   initial `owner` account.
4. **🟡 Modifier applicability.** The menu prints Add-ons, Milk of Choice, and
   Cream Supreme as one block for the whole menu. Do all three apply to every
   drink — is "oat milk +40" meaningful on an americano, or "Matcha Cream +65"
   on a matcha? The build assumes all groups apply to all drinks; if some pair
   badly, the model needs a per-item allowlist.
5. **🟡 Size labels.** M / L / XL are the printed headers. Confirm these are the
   words customers use, and whether they map to volumes worth showing (16oz etc).
6. **🟡 Bestseller stars.** Eleven items are starred on the printed menu. The build
   stores `is_bestseller` and surfaces a "Bestsellers" row on the order page;
   say so if the star is meant as in-store decoration only.
7. **🟢 Naming.** The Google listing is "KennCo. Cafe", Facebook is
   `kennco.cafebxu`, the site says "Kennko Coffee". Which is canonical for
   customer-facing copy and the confirmation emails? Build uses "Kennko Coffee".
8. **🟢 Domain.** Current deploy is a `.vercel.app` URL. A custom domain makes
   the confirmation emails far less likely to be treated as phishing.
9. **🟢 Stale brief.** `BRIEF.md` lists Berry Matcha, Coconut Series, Vanilla
   Milk Cloud Foam, and Strawberry Cloud Soda, none of which are on the current
   menu, and its category names no longer match. The brief gets corrected from
   Appendix A during seeding.

## 13. Responsive requirements

Explicitly requested, and treated as acceptance criteria rather than polish.

- **Phone (≤ 640px)** — single column throughout. Cart is a bottom sheet with a
  persistent total bar. Admin order queue is stacked cards, not a table; verify
  and reject are full-width tap targets ≥ 44px. Payment screenshot opens
  full-screen with pinch-zoom, because reading a reference number off a
  thumbnail is not possible.
- **Tablet (641–1024px)** — two-column menu grid; admin uses a condensed table
  with the actions column pinned. This is the likeliest counter device and gets
  explicit layout attention rather than inheriting the phone or desktop case.
- **Desktop (> 1024px)** — three-column menu, full admin table, side-by-side
  order detail and screenshot.

Every layout is verified at 375, 768, 1024, and 1440px before a task is
considered done.

## 14. Testing strategy

- **Unit** — money formatting, total computation across size tiers and
  modifiers, order code generation, duplicate-reference detection, upload
  magic-byte validation, image dimension and size checks.
- **Integration** — order submission writes both tables atomically and rolls
  back on failure; price-change race returns `409`; RLS actually denies a
  barista's price update and an anon `select` on `orders`. Storage policies are
  tested directly: an anon client must fail to write `menu-images`, a barista
  client must fail to write `menu-images`, and an anon client must fail to read
  `payment-proofs`. Replacing a product image deletes the prior object.
- **E2E (Playwright)** — full customer path browse → cart → checkout → upload →
  submit; staff path login → verify → customer email queued. Run at the phone
  and tablet viewports, not just desktop.
- **Email** — Resend sandbox in tests; assert payload and recipients, never send
  to real inboxes from a test run.

## 15. Rollout

1. Port the marketing page to Next.js with the menu still hardcoded. Deploy.
   Nothing changes for visitors; the framework migration is proven in isolation.
2. Add Supabase, schema, RLS, and seed the menu. Public page now renders from
   the database. Still no ordering.
3. Admin auth, order queue (empty), menu CRUD including product image upload.
   Owner corrects prices and uploads photos here.
4. Customer ordering behind a feature flag; internal test orders end to end.
5. Enable ordering publicly once prices and the QR are confirmed correct.

Ordering stays flagged off until the real GCash QR replaces the placeholder
(§12, question 1). Everything else can be built, tested, and reviewed behind the
flag. Shipping an order form that points customers at a sample QR would be worse
than shipping nothing.

## 16. Impact on existing project rules

`CLAUDE.md` currently states the project is a single self-contained
`index.html`, static, with no server-side code. This work makes all three false.
`CLAUDE.md` must be rewritten as part of step 1 of the rollout to describe the
Next.js structure, the Supabase dependency, and the environment variables —
otherwise it actively misleads the next person or agent to open the repo.


---

## Appendix A — Menu inventory (from `brand/Kennko Menu.png`)

Source of truth for seeding. ★ marks a bestseller on the printed menu. `—`
means that size is not offered. Prices in pesos.

> **This graphic is a data reference, not a design reference.** Its navy/cream
> vintage treatment is not the brand direction — the site keeps the existing
> electric blue `#0055FF` identity described in `BRIEF.md`.

### Premium Classics

| Item | M | L | XL | HOT |
|---|--:|--:|--:|--:|
| americano | 80 | 90 | 100 | 95 |
| café latte | 100 | 115 | 130 | 125 |
| vanilla latte | 105 | 125 | 135 | 135 |
| hazelnut latte | 105 | 125 | 135 | 135 |
| ★ spanish latte | 105 | 125 | 135 | 135 |
| ★ white café mocha | 110 | 130 | 140 | 135 |
| dark café mocha | 110 | 130 | 140 | 135 |
| ★ caramel macchiato | 110 | 130 | 140 | 135 |

### Barista's Choice

| Item | M | L | XL | HOT |
|---|--:|--:|--:|--:|
| vietnamese coffee | 110 | 130 | 140 | 135 |
| ★ egg coffee | 125 | 145 | 165 | 155 |
| coconut coffee | 125 | 145 | 160 | 155 |
| ★ sea salt caramel oat | 130 | 150 | 170 | 160 |
| honey oat latte | 130 | 150 | 170 | 160 |

### Sweet Sips

| Item | M | L | XL | HOT |
|---|--:|--:|--:|--:|
| ★ strawberry milk | 105 | 125 | 135 | — |
| ★ strawberry matcha | 125 | 145 | 155 | — |
| ★ signature choco | 105 | 125 | 135 | 135 |
| ★ choco-coconut | 125 | 145 | 155 | — |
| vanilla milk | 105 | 125 | 135 | 135 |

### Matcha Series

| Item | M | L | XL | HOT |
|---|--:|--:|--:|--:|
| ★ matcha | 115 | 135 | 145 | 145 |
| matcha coco | 135 | 155 | 175 | 165 |
| dirty matcha | 140 | 160 | 180 | 170 |
| ★ hojicha | 140 | 160 | — | 160 |

### Modifiers

| Group | Option | Surcharge | Select |
|---|---|--:|---|
| Add-ons | espresso shots | +35 | multi |
| Add-ons | milk | +20 | multi |
| Add-ons | sugar syrup | +20 | multi |
| Add-ons | milk syrup | +25 | multi |
| Add-ons | flavor sauce | +30 | multi |
| Milk of Choice | oat milk | +40 | single |
| Milk of Choice | soy milk | +35 | single |
| Cream Supreme | Salty Vanilla Cream | +50 | single |
| Cream Supreme | Choco Cream | +45 | single |
| Cream Supreme | Matcha Cream | +65 | single |
| Cream Supreme | Coconut Cream | +50 | single |

**Totals:** 4 categories, 22 drinks, 11 bestsellers, 11 modifiers in 3 groups.
