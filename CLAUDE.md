# Kennko Coffee — Build Instructions

## What This Is
A Next.js (App Router, TypeScript) site for Kennko Coffee, deployed on Vercel,
with menu data in Supabase Postgres.

## Brand Context
Read `brand/BRIEF.md` for cafe info, brand guidelines, palette, and copy tone.
The brand is the electric blue `#0055FF` identity. `brand/Kennko Menu.png` is a
**data reference only** — its navy/serif styling is not the design direction.

## Structure
- `app/` — routes and layout
- `components/site/` — marketing page sections
- `lib/` — money formatting, Supabase clients, menu queries
- `supabase/migrations/` — schema, applied with `npx supabase db push`
- `supabase/seed/` — menu seed data, loaded with `npm run seed`
- `public/brand/` — brand assets served by the app (lowercase kebab-case names)

## Conventions
- Money is stored and passed as **integer centavos**. Format only at render,
  via `formatPesos()` in `lib/money.ts`.
- Use `type`, never `interface`.
- Mobile, tablet, and desktop are all required. Breakpoints: 920px and 640px.
  Verify at 375, 768, 1024, and 1440px.
- The cafe is at **CT. Montalban St., Villa Kananga, Butuan City** — it moved
  out of SM Butuan. No file should say "SM Butuan".

## Environment
Copy `.env.local.example` to `.env.local` and fill it in. The app will not build
without `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The
service-role key is needed only to run the seeder, and must never be committed
or exposed to the browser.

## Commands
- `npm run dev` — local dev server
- `npm test` — unit tests
- `npm run build` — production build
- `npm run seed` — seed the menu from `supabase/seed/menu.ts`

## Admin

Routes under `/admin`, signed in with Supabase Auth (email + password, no
public signup).

| Capability | Barista | Owner |
|---|:--:|:--:|
| See the menu, mark items sold out / available | yes | yes |
| Add, edit, re-price, archive drinks | no | yes |
| Upload and remove product photos | no | yes |
| Invite staff, change roles, deactivate accounts | no | yes |

**Authorisation is enforced in Postgres, not just the UI.** `public.is_owner()`
and `public.is_active_staff()` back the RLS policies, and a `BEFORE UPDATE`
trigger on `menu_items` rejects any barista change other than `is_available` —
RLS cannot restrict which columns an update touches, and column `GRANT`s cannot
either, since both roles share the `authenticated` database role. Never rely on
a hidden button as a permission check.

**`proxy.ts`, not `middleware.ts`.** `middleware.ts` is deprecated in Next 16.
The proxy only refreshes the Supabase session cookie, scoped to `/admin/:path*`
so the public page stays statically cached; the auth guard lives in
`app/admin/layout.tsx`.

**A `'use server'` module may only export async functions.** Pure helpers live
beside them in plain modules — `app/admin/menu/format.ts`,
`app/admin/login/validate.ts`, `app/admin/staff/guards.ts`.

**Storage buckets are deliberately separate.** `menu-images` is public-read /
owner-write. Plan 3 adds `payment-proofs`, which is fully private. Never merge
them: making one bucket public to serve menu photos would expose customer
payment receipts.

Bootstrap the first owner with
`npm run create-owner -- <email> <password> "<Full Name>"`.

## Ordering

Guest checkout at `/order` -- no customer accounts. Customers choose **pickup or
delivery**; name, email, and phone are always required, and a street address
plus barangay are required for delivery only.

**The client total is never trusted.** `POST /api/orders` reprices every line
from `menu_items`, takes the delivery fee from the `delivery_zones` row for the
chosen barangay, and returns `409 PRICE_CHANGED` on a mismatch. A barangay with
no active zone is refused with `OUTSIDE_SERVICE_AREA`.

**Payment is GCash on a static QR, verified by a human.** Nothing in this system
talks to GCash. The customer submits a reference number and a receipt
screenshot; a staff member checks it in the GCash app and confirms. The customer
confirmation email sends only on that confirmation -- never on submission. The
admin flags any reference already used by another live order.

**`payment-proofs` is a PRIVATE bucket**, separate from public `menu-images`.
Staff read receipts through 300-second signed URLs. Never make it public: a
receipt carries the customer's name and GCash details.

Order status flow differs by fulfilment: pickup runs
`confirmed -> preparing -> ready -> completed`; delivery runs
`confirmed -> preparing -> out_for_delivery -> completed`.

Ordering is gated by `NEXT_PUBLIC_ORDERING_ENABLED`. It stays `false` until the
real GCash QR replaces `public/gcash-qr-placeholder.png`.

### Delivery pricing

**No maps API, and no cost.** The site's location map is a keyless
`google.com/maps?...&output=embed` iframe, which is not metered. Delivery fees
are computed, not looked up:

- Free inside **Villa Kananga** (the cafe's own barangay, `is_home`).
- Otherwise **₱20 per started 4km band**, measured from the cafe pin to the
  barangay centre with the haversine formula in `lib/delivery/distance.ts`.
- Straight-line distance is multiplied by `ROAD_FACTOR` (1.3), because riders
  follow streets. Without it every fee is systematically under-charged.
- A zone can be pinned to a fixed price with `fee_override_centavos`.

The fee is always recomputed server-side from the zone's own coordinates, so a
client cannot claim to be nearer than it is.

**The seeded coordinates are approximate estimates.** A wrong one charges the
wrong fee — verify each against the map before going live. Everyone in a
barangay pays the same fee, which is predictable to quote and hard to dispute.

Seed delivery zones with `npm run seed-zones`.

### Customer accounts

Ordering is guest-first: nobody has to sign up. An **optional** account exists
only so a returning customer can see their history at `/orders`.

- **Google only.** Customers never get a password; staff keep email + password
  at `/admin/login`. The two are unrelated: a customer is any authenticated
  user, and admin rights come solely from a row in `staff`.
- **Claiming guest orders.** An order placed while signed in stores
  `customer_user_id`. A guest order also appears in history when its email
  matches the account's **confirmed** address -- the confirmation check is the
  security boundary, and Google accounts always arrive confirmed.
- `public.owns_order()` is SECURITY DEFINER for the same reason `is_owner()` is:
  a policy that reads `auth.users` directly errors for `anon`/`authenticated`
  rather than evaluating.
- `safeNextPath()` sanitises every post-sign-in redirect. Never pass a raw
  `?next` through.

**Google OAuth must be enabled in the Supabase dashboard** with a Google Cloud
client ID and secret, and the callback `/auth/callback` allow-listed. Without
it, sign-in fails and the page tells the customer to order as a guest.

### Email

Resend, configured by `RESEND_API_KEY`. Without the key, sends are logged and
the request continues -- a missing key must never lose a paid order. The same
applies when Resend rejects a send: it is logged, the order still saves.

**Until a domain is verified at resend.com/domains, the account can only deliver
to the Resend account owner's own address.** Staff alerts to any other address
return 403. Verify a domain and set `ORDER_EMAIL_FROM` to an address on it
before going live, or staff will silently never be alerted to a real order.

## Planned Work
`docs/superpowers/specs/` holds the ordering + admin design spec.
`docs/superpowers/plans/` holds the implementation plans. Plan 1 (this
foundation), 2 (admin), and 3 (ordering) are all complete.

## Deploying
Vercel auto-deploys on push to `main`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
