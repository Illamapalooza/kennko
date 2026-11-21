# Kennko Coffee Website — Build Instructions

## What This Is
A Next.js (App Router, TypeScript) site for Kennko Coffee, deployed on Vercel,
with menu data in Supabase Postgres.

## POS, wall and the monorepo
This repo also holds the shop till (`apps/pos`), shared pricing rules (`packages/core`) and the projector wall
(`wall/`). **Read `docs/HANDOVER-pos.md` before working on any of them**: it has the current state, what Julius
decided, and what is next.

## Brand Context
Read `../../brand/BRIEF.md` for cafe info, brand guidelines, palette, and copy tone.
The brand is the electric blue `#0055FF` identity. `../../brand/Kennko Menu.png` is a
**data reference only** — its navy/serif styling is not the design direction.

## Structure
- `app/` — routes and layout
- `components/site/` — marketing page sections
- `lib/` — money formatting, Supabase clients, menu queries
- Database migrations live in `apps/api/supabase/migrations/`; apply them from `apps/api` with `npx supabase db push`
- `supabase/seed/` — menu seed data, loaded with `npm run seed` (the menu list itself lives in `packages/core/src/seed-menu.ts`, shared with the till)
- `public/brand/` — brand assets served by the app (lowercase kebab-case names)

## Conventions
- Money is stored and passed as **integer centavos**. Format only at render,
  via `formatPesos()` in `lib/money.ts` (re-exported from `@kennko/core`, shared with the till).
- Use `type`, never `interface`.
- Mobile, tablet, and desktop are all required. Breakpoints: 920px and 640px.
  Verify at 375, 768, 1024, and 1440px.
- The cafe is at **CT. Montalban St., Villa Kananga, Butuan City** — it moved
  out of SM Butuan. Never give SM Butuan as Kennko's location or address. SM City Butuan may appear
  only as a landmark for directions (the route on the Visit map).

## Environment
Copy `.env.local.example` to `.env.local` and fill it in. The app will not build
without `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

**The website does not use the Supabase service key.** Every privileged read or write goes through the
API (`lib/api/client.ts`): `publicFetch` (order page, receipt), `userFetch` (a customer's `/orders`),
`staffFetch` (admin, proofs, the customer-email data) and `webKeyFetch` (the checkout's staff alert list,
sent with `KENNKO_WEB_KEY`, which must equal the API's). `SUPABASE_SERVICE_ROLE_KEY` is for the local
`scripts/` only (seed, seed-zones, create-owner) and is never set on Vercel; `lib/no-service-key.test.ts`
fails if `app/`, `components/`, `lib/` or `proxy.ts` name it or a service-role client.

## Commands
Run these from `apps/web` (the repo root has `npm run dev`, `npm run build` and `npm test` shortcuts).
- `npm run dev` — local dev server
- `npm test` — unit tests
- `npm run build` — production build
- `npm run seed` — seed the menu from `supabase/seed/menu.ts`

## Admin

Routes under `/admin`, signed in with Supabase Auth (email + password, no
public signup).

| Capability | Barista | Manager | Owner |
|---|:--:|:--:|:--:|
| See the menu, mark items sold out / available | yes | yes | yes |
| Add, edit, re-price, archive drinks | no | no | yes |
| Upload and remove product photos | no | no | yes |
| Add staff, change roles, deactivate accounts | no | no | yes |
| Issue till PINs (Staff screen) | no | no | yes |
| Day report (Reports screen, `/v1/reports/day/:date`) | no | yes | yes |
| Look up customers, switch a card between digital and paper, apply or discard "stamps to check" (Customers screen) | no | yes | yes |
| Adjust a customer's points | no | no | yes |
| Hide a cat from the wall, or show it again (Customers screen, `/v1/customers/:id/cat/hidden`) | no | yes | yes |
| Cosmetics catalogue: rename, reprice in points, switch off, reorder; starters stay free and on (Cosmetics screen, `/v1/cosmetics`) | no | no | yes |
| Needs a look: set aside held till receipts, mark flagged ones seen, close a stuck shift, retry a till | no | no | yes |

A manager has barista-level access on the website; owner-only stays owner-only. Staff are
managed through the API (`/v1/staff`), not Supabase: the Staff screen adds people, changes roles and
issues till PINs there. A **barista needs no website login or email** (they use a PIN at the till); an
owner needs a login, a manager may have one. The Staff screen posts the email to `POST /v1/staff`, and the
API sends the invite and takes the login back if the staff row fails; the screen shows the API's
`ALREADY_REGISTERED` and `EMAIL_TAKEN` messages. A PIN is generated, shown once, and
never stored in the clear.

**Authorisation is enforced in Postgres, not just the UI.** `public.is_owner()`
and `public.is_active_staff()` back the RLS policies, and a `BEFORE UPDATE`
trigger on `menu_items` rejects any barista change other than `is_available` —
RLS cannot restrict which columns an update touches, and column `GRANT`s cannot
either, since both roles share the `authenticated` database role. Never rely on
a hidden button as a permission check.

**`proxy.ts`, not `middleware.ts`.** `middleware.ts` is deprecated in Next 16.
The proxy only refreshes the Supabase session cookie, scoped to the routes that read the session (`/admin`, `/orders`, `/account`, `/auth`, `/here`)
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

Guest checkout at `/order` -- an account is optional. Customers choose **pickup or
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
Staff read receipts through 300-second signed URLs from the API (`GET /v1/payments/:id/proof`). Never make it public: a
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
  barangay centre with the haversine formula in `packages/core/src/delivery.ts`.
- Straight-line distance is multiplied by `ROAD_FACTOR` (1.3), because riders
  follow streets. Without it every fee is systematically under-charged.
- A zone can be pinned to a fixed price with `fee_override_centavos`.

The fee is always recomputed server-side from the zone's own coordinates, so a
client cannot claim to be nearer than it is.

**The seeded coordinates are approximate estimates.** A wrong one charges the
wrong fee — verify each against the map before going live. Everyone in a
barangay pays the same fee, which is predictable to quote and hard to dispute.

### The delivery pin

Customers may share their location with one tap — `navigator.geolocation`, no
map, no tiles, no dependency, no key. It does two jobs: the rider gets a
coordinate to navigate to (informal addresses are the norm here), and the fee is
measured from where they actually are.

**The pin is client-supplied and sets the price, so it is never trusted alone.**
`verifyPin()` checks it against the chosen barangay, which *is* looked up
server-side. A pin more than 4km from that barangay's centre is refused with
`PIN_MISMATCH` — otherwise anyone could pin the cafe and pay no delivery fee.
This bounds manipulation to within one barangay: exactly the granularity fees
had before pins existed, so a liar gains nothing.

Degradation is deliberate: a GPS fix looser than 500m, a declined permission, or
no pin at all all fall back to the barangay centre and the order still goes
through. Only an inconsistent pin fails the order.

Seed delivery zones with `npm run seed-zones`.

### Customer accounts

Ordering is guest-first: nobody has to sign up. An **optional** account exists
only so a returning customer can see their history at `/orders`.

- **Google or an email link.** Customers never get a password: `/account` offers Google and a Supabase
  magic link (`signInWithOtp`, `/auth/callback` exchanges the code either way). Staff keep email + password
  at `/admin/login`. The two are unrelated: a customer is any authenticated user, and admin rights come
  solely from a row in `staff`.
- **Kennko card.** Signed in is not the same as having a card. "Get my Kennko card" (13+ and the privacy
  notice, `PRIVACY_VERSION` in `lib/privacy.ts`) posts `/v1/me/join`. `/account` then shows the QR code
  (`qrSvg`, server-rendered), the typed code, the 8-circle stamp card or the paper notice, and points. It
  redirects away only when `?next` is present. Deletion needs `DELETE` typed and calls `DELETE /v1/me`
  (staff logins are refused); on success the user is signed out and sent to `/?account=deleted`.
- **Claiming guest orders.** An order placed while signed in stores `customer_user_id`. A guest order also
  appears in history when its email matches the account's **confirmed** address **and it was placed after the
  account (the `auth.users` row) was created**; earlier guest orders no longer show. The confirmation check is
  the security boundary, and Google accounts always arrive confirmed.
- `public.owns_order()` is SECURITY DEFINER for the same reason `is_owner()` is:
  a policy that reads `auth.users` directly errors for `anon`/`authenticated`
  rather than evaluating.
- `safeNextPath()` sanitises every post-sign-in redirect. Never pass a raw
  `?next` through.

**Google OAuth must be enabled in the Supabase dashboard** with a Google Cloud
client ID and secret, and the callback `/auth/callback` allow-listed. Without
it, sign-in fails and the page tells the customer to order as a guest.

### Wall check-in (`/here`)

The wall's QR opens `/here?c=<code>`. The page load never checks in (a link preview could trigger it): the customer
taps "Walk my cat in", which calls the `checkIn` server action (`POST /v1/checkin`). Signed out → sign in with
`/account?next=/here?c=<code>` (encoded; `safeNextPath` guards it). The code expires in about two minutes; it is
validated (`parseWallCode`) and never logged. The page sets `referrer: no-referrer` and `noindex`.

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
