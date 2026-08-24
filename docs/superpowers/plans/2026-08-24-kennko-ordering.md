# Kennko Ordering (Plan 3 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a guest customer order drinks for pickup or delivery, pay by GCash, and submit proof — and let staff verify that payment before anyone makes a drink.

**Architecture:** Guest checkout, no accounts. Cart lives in `localStorage`; the server never trusts it. `POST /api/orders` recomputes the subtotal from current prices, adds the delivery fee from `delivery_zones`, and rejects mismatches. Payment proof goes to a **private** `payment-proofs` bucket. Staff verify in the admin queue; only then does the customer get a confirmation email.

**Tech Stack:** Next.js 16, TypeScript, Supabase (Postgres + RLS + Storage), Resend, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-kennko-ordering-design.md`

**Predecessors:** Plans 1 and 2, both complete.

## Global Constraints

- **Money is integer centavos.** `total = subtotal + delivery_fee`, enforced by a CHECK constraint.
- **`type`, never `interface`.**
- **The client total is never trusted.** Always recompute server-side.
- **A `'use server'` module may only export async functions.** Pure helpers go in plain modules.
- **`payment-proofs` is PRIVATE.** Never public, never merged with `menu-images`. Receipts carry customer names and GCash details.
- **Phone, tablet, desktop.** Breakpoints 920px / 640px; tap targets ≥ 44px.
- **Ordering ships behind `NEXT_PUBLIC_ORDERING_ENABLED`.** It stays off until the real GCash QR replaces the placeholder.
- **Supabase project ref is `lgyfijnfbccifozpnbij`.** Never touch another project.

---

### Task 1: Orders schema, delivery zones, and the private bucket

**Files:** `supabase/migrations/0005_orders.sql`

- [ ] **Step 1: Write the migration**

```sql
create type fulfilment_method as enum ('pickup', 'delivery');

create type order_status as enum (
  'awaiting_verification', 'confirmed', 'preparing',
  'ready', 'out_for_delivery', 'completed', 'rejected', 'cancelled'
);

create table delivery_zones (
  id           uuid primary key default gen_random_uuid(),
  barangay     text not null unique,
  fee_centavos int not null check (fee_centavos >= 0),
  is_active    boolean not null default true,
  sort_order   int not null default 0
);

create table orders (
  id                    uuid primary key default gen_random_uuid(),
  order_code            text not null unique,
  customer_name         text not null,
  customer_phone        text not null,
  customer_email        text not null,
  fulfilment            fulfilment_method not null,
  delivery_address      text,
  delivery_barangay     text,
  delivery_zone_id      uuid references delivery_zones(id),
  fulfil_at             timestamptz not null,
  status                order_status not null default 'awaiting_verification',
  subtotal_centavos     int not null check (subtotal_centavos >= 0),
  delivery_fee_centavos int not null default 0 check (delivery_fee_centavos >= 0),
  total_centavos        int not null check (total_centavos >= 0),
  gcash_reference       text not null,
  payment_proof_path    text not null,
  customer_note         text,
  staff_note            text,
  verified_by           uuid references staff(id),
  verified_at           timestamptz,
  created_at            timestamptz not null default now()
);

-- A delivery order without an address is meaningless; a pickup order carrying
-- one means the form is confused. Both rejected at the database.
alter table orders add constraint orders_delivery_needs_address check (
  (fulfilment = 'delivery'
     and delivery_address is not null and delivery_barangay is not null
     and delivery_zone_id is not null)
  or
  (fulfilment = 'pickup'
     and delivery_address is null and delivery_barangay is null
     and delivery_zone_id is null and delivery_fee_centavos = 0)
);

alter table orders add constraint orders_total_is_subtotal_plus_fee check (
  total_centavos = subtotal_centavos + delivery_fee_centavos
);

create index orders_status_created_idx on orders (status, created_at desc);
create index orders_gcash_reference_idx on orders (gcash_reference);

create table order_items (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references orders(id) on delete cascade,
  menu_item_id        uuid references menu_items(id) on delete set null,
  name_snapshot       text not null,
  size                drink_size not null,
  base_price_centavos int not null,
  quantity            int not null check (quantity > 0 and quantity <= 20),
  line_total_centavos int not null,
  created_at          timestamptz not null default now()
);

create table order_item_modifiers (
  id             uuid primary key default gen_random_uuid(),
  order_item_id  uuid not null references order_items(id) on delete cascade,
  modifier_id    uuid references modifiers(id) on delete set null,
  name_snapshot  text not null,
  price_centavos int not null
);

alter table delivery_zones       enable row level security;
alter table orders               enable row level security;
alter table order_items          enable row level security;
alter table order_item_modifiers enable row level security;

-- Public may read active zones (to pick a barangay and see the fee).
create policy "public reads active zones"
  on delivery_zones for select using (is_active);
create policy "owner writes zones"
  on delivery_zones for all using (public.is_owner()) with check (public.is_owner());

-- Public may NOT select orders at all. Status lookup goes through a server
-- route keyed on order_code, returning a narrow projection.
create policy "staff read orders"
  on orders for select using (public.is_active_staff());
create policy "staff update orders"
  on orders for update using (public.is_active_staff());
create policy "staff read order items"
  on order_items for select using (public.is_active_staff());
create policy "staff read order item modifiers"
  on order_item_modifiers for select using (public.is_active_staff());

-- Order creation goes through the service role in a server route, which is
-- what enforces server-side pricing. No anon insert policy exists, so a
-- crafted client request cannot write an order directly.

-- Payment proofs: PRIVATE. Staff read via short-lived signed URLs. A public
-- bucket would expose every customer's name and GCash reference.
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do nothing;

create policy "staff read payment proofs"
  on storage.objects for select
  using (bucket_id = 'payment-proofs' and public.is_active_staff());
```

- [ ] **Step 2: Apply and verify**

Apply via the Management API, then confirm `payment-proofs` has `public = false`. **If it is public, stop and fix it** — that bucket leaks customer data.

- [ ] **Step 3: Commit**

---

### Task 2: Seed delivery zones

**Files:** `supabase/seed/zones.ts`, `scripts/seed-zones.ts`, `supabase/seed/zones.test.ts`

Butuan City barangays near Villa Kananga, with a flat starter fee the owner adjusts in admin.

- [ ] **Step 1: Write the seed data and a test asserting every fee is whole centavos and every barangay unique.**
- [ ] **Step 2: Write and run the seeder.**
- [ ] **Step 3: Commit.**

---

### Task 3: Cart maths (pure, tested)

**Files:** `lib/cart/types.ts`, `lib/cart/total.ts`, `lib/cart/total.test.ts`

**Produces:** `lineTotal(line)`, `cartSubtotal(lines)`, `orderTotal(subtotal, feeCentavos)`, `generateOrderCode()`.

- [ ] **Step 1: Failing tests**

```ts
describe('lineTotal', () => {
  it('multiplies base plus modifiers by quantity', () => {
    expect(lineTotal({ basePriceCentavos: 10500, modifiers: [{ priceCentavos: 4000 }], quantity: 2 })).toBe(29000)
  })
  it('handles no modifiers', () => {
    expect(lineTotal({ basePriceCentavos: 8000, modifiers: [], quantity: 1 })).toBe(8000)
  })
  it('rejects quantity below 1', () => {
    expect(() => lineTotal({ basePriceCentavos: 8000, modifiers: [], quantity: 0 })).toThrow('at least 1')
  })
  it('rejects quantity above 20', () => {
    expect(() => lineTotal({ basePriceCentavos: 8000, modifiers: [], quantity: 21 })).toThrow('more than 20')
  })
})

describe('orderTotal', () => {
  it('adds the delivery fee', () => { expect(orderTotal(29000, 5000)).toBe(34000) })
  it('adds nothing for pickup', () => { expect(orderTotal(29000, 0)).toBe(29000) })
})

describe('generateOrderCode', () => {
  it('is KNK- plus four unambiguous characters', () => {
    expect(generateOrderCode()).toMatch(/^KNK-[ACDEFHJKLMNPRTUVWXY34679]{4}$/)
  })
  it('does not repeat across many draws', () => {
    expect(new Set(Array.from({ length: 500 }, generateOrderCode)).size).toBeGreaterThan(490)
  })
})
```

The code alphabet excludes `0/O`, `1/I/L`, `B/8`, `S/5`, `2/Z`, `G/6` — customers read these aloud over the phone.

- [ ] **Step 2: Implement, run, commit.**

---

### Task 4: Checkout validation (pure, tested)

**Files:** `lib/orders/validate.ts`, `lib/orders/validate.test.ts`

**Produces:** `validateCheckout(input): string[]` — returns every problem at once, so the customer fixes one form rather than five.

- [ ] **Step 1: Failing tests** covering: name/email/phone always required; PH mobile format (`09XXXXXXXXX` or `+639XXXXXXXXX`); address and barangay required for delivery, rejected for pickup; `fulfilAt` must be in the future; GCash reference required and 6–20 alphanumerics.
- [ ] **Step 2: Implement, run, commit.**

---

### Task 5: Order API with server-side repricing

**Files:** `app/api/orders/route.ts`, `lib/orders/create.ts`

The heart of the plan. Never trusts the client.

- [ ] **Step 1:** Parse multipart form (cart JSON + proof file).
- [ ] **Step 2:** Validate with `validateCheckout`; 400 with the list on failure.
- [ ] **Step 3:** Validate the image with `validateImage` (Plan 2).
- [ ] **Step 4:** Reprice: load each `menu_item_prices` row and each `modifiers` row by id; reject unknown, unavailable, or archived items. Compute subtotal.
- [ ] **Step 5:** For delivery, look up the zone by barangay; reject if inactive or missing with `OUTSIDE_SERVICE_AREA`. Fee comes from the row, never the request.
- [ ] **Step 6:** If recomputed total ≠ submitted total, return `409 PRICE_CHANGED`.
- [ ] **Step 7:** Upload the proof to `payment-proofs`, then insert order + items + modifiers. On any insert failure, remove the uploaded object so no orphan is billed.
- [ ] **Step 8:** Fire the staff email (Task 8). Return `{ orderCode }`.
- [ ] **Step 9:** Rate-limit per IP; without it the upload endpoint is an open storage bill.
- [ ] **Step 10:** Commit.

---

### Task 6: Customer ordering UI

**Files:** `app/order/page.tsx`, `app/order/OrderClient.tsx`, `components/order/*`, `app/order/order.css`

- [ ] **Step 1:** Menu browse from `getMenu()`; unavailable items greyed and unselectable.
- [ ] **Step 2:** Item sheet — size (only offered sizes), modifiers by group (Add-ons multi, others single), quantity.
- [ ] **Step 3:** Cart in `localStorage`, surviving refresh; bottom sheet with running total on phone.
- [ ] **Step 4:** Fulfilment toggle. Delivery reveals address + barangay picker and shows the fee **before** payment.
- [ ] **Step 5:** Checkout fields; inline errors from `validateCheckout`.
- [ ] **Step 6:** GCash step — placeholder QR, exact amount, reference input, screenshot upload.
- [ ] **Step 7:** Confirmation screen stating plainly the order is **not yet confirmed**.
- [ ] **Step 8:** Verify at 375/768/1024/1440. Commit.

---

### Task 7: Order status lookup

**Files:** `app/order/[code]/page.tsx`, `lib/orders/lookup.ts`

- [ ] Server-side lookup by `order_code` returning a narrow projection — never the payment proof path or staff notes. Commit.

---

### Task 8: Email notifications

**Files:** `lib/email/send.ts`, `lib/email/templates.ts`, `lib/email/templates.test.ts`

- [ ] **Step 1:** Tests asserting the staff subject carries the order code and total, and that the customer confirmation names the fulfilment method and time.
- [ ] **Step 2:** Implement with Resend. **When `RESEND_API_KEY` is absent, log and continue rather than throwing** — a missing key must never lose a paid order.
- [ ] **Step 3:** Commit.

---

### Task 9: Admin order queue and verification

**Files:** `app/admin/orders/page.tsx`, `app/admin/orders/actions.ts`, `components/admin/OrderCard.tsx`

- [ ] **Step 1:** Queue sorted `awaiting_verification` first; each shows reference, total, items, fulfilment, and a signed URL to the proof.
- [ ] **Step 2:** Duplicate-reference flag — any other non-rejected order sharing a `gcash_reference`.
- [ ] **Step 3:** Confirm → `confirmed` + stamp verifier + customer email. Reject → requires a reason, sends rejection email.
- [ ] **Step 4:** Status advance: pickup `confirmed → preparing → ready → completed`; delivery `confirmed → preparing → out_for_delivery → completed`.
- [ ] **Step 5:** Poll every 20s, show the unverified count in the page title.
- [ ] **Step 6:** Phone layout is stacked cards; proof opens full-screen. Commit.

---

### Task 10: Zones admin, flag, docs

- [ ] **Step 1:** `/admin/zones` — owner edits barangays and fees.
- [ ] **Step 2:** `NEXT_PUBLIC_ORDERING_ENABLED` gates the Order nav link and `/order`.
- [ ] **Step 3:** Update `CLAUDE.md`, `README.md`, `.env.local.example`.
- [ ] **Step 4:** Full suite, typecheck, build. Commit.

---

## Definition of Done

- [ ] Tests, typecheck, and build all pass; `/` still `○ (Static)`.
- [ ] A guest can order for pickup with no address asked.
- [ ] A guest can order for delivery, sees the fee before paying, and cannot pick an unserved barangay.
- [ ] A tampered client total is rejected with `409`.
- [ ] A delivery order with no address is rejected **by the database**, not just the form.
- [ ] `payment-proofs` is private; an anon request for a proof fails.
- [ ] Duplicate GCash references are flagged in the queue.
- [ ] The customer confirmation email sends only on staff confirmation.
- [ ] Ordering is off unless `NEXT_PUBLIC_ORDERING_ENABLED=true`.
