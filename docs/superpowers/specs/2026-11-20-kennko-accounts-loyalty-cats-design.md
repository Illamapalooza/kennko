# Kennko accounts, digital stamp card and Kennko cats

**Status:** for approval, 2026-11-20. Reviewed for robustness and by a cold-read builder; findings folded in. Builds
on `2026-11-20-kennko-backend-design.md` (approved) and changes one of its non-goals: loyalty now lives in the
database.

**Decided by Julius:**
- **Stamp card:**
  - One digital stamp card per customer, stamped only by staff.
  - A manager can mark a customer as on the paper card. No digital card is created, and the account says so.
  - 8 stamps per card. The free upsize at 4 is dropped.
  - **One stamp per paid order that includes a drink.** Food-only orders earn no stamp.
  - **A full card is one free drink of any size; add-ons are paid.** Staff mark it claimed and a new card starts.
- **Points and cats:**
  - Every customer has a customisable pixel cat.
  - Paid purchases earn 1 point per ₱10, spent on cat cosmetics. Cosmetics are never sold for money.
  - A customer's cat appears on the wall when they are at Kennko, detected by scanning a rotating QR code on the
    wall.
- **Age:** accounts are for **ages 13 and up**, with a short privacy notice at sign-up.

Calls Claude made are marked *(Claude's call)*.

## Why

Julius wants regulars to have a reason to sign in: a stamp card that can't be lost, and a cat of their own that
lives in Kennko's world and shows up on the projector wall when they visit. Accounts are built once to carry both,
and later customer features.

## Goals

1. Customer accounts any regular can create in under a minute.
2. A digital stamp card that staff stamp, that works at the counter even offline, and that pays out a free drink at
   8 stamps.
3. A clear paper-card state for customers who already carry the paper card.
4. A pixel cat per customer, customised with cosmetics bought with points from purchases.
5. The customer's cat walks onto the wall while they are in the shop.

## Non-goals

- Automatic stamps. A stamp is always a staff action.
- Buying cosmetics with money, trading or gifting them.
- Location tracking of any kind.
- Moving paper-card stamps onto a digital card. A paper-card customer switched to digital by a manager starts a
  fresh card *(Claude's call)*.
- Leaderboards, friends and social features.
- Defending the wall code against sharing. A photo sent to a friend works for about two minutes, and only a cat on
  the wall is at stake.

## Anti-goals

- **A stamp or point awarded twice for one order**, or a free drink claimed twice.
- **A real name or contact detail on the wall or the till.** The wall shows the cat and the cat name the customer
  chose; the till shows the cat name, the stamp count and the card state, nothing more.
- **Points from unpaid, rejected, cancelled or refunded orders.**
- **A slower counter.** Linking a customer is one scan, and skipping it is always allowed.
- **A counter event refused.** As in the backend design, what the till did is recorded and flagged, never dropped.

## Sign-in and accounts

- **Methods** *(Claude's call)*:
  - **Google**, as today.
  - **Email sign-in link**, with no password.
  - Both are built into Supabase at no extra cost, and emails go through Resend.
  - Phone-number codes are left out, since every SMS costs money.
- **Joining is opt-in.** Signing in alone keeps working for order history, as today. A customer gets a Kennko card
  (`customers` row, public code and starter cat) only when they tap "Get my Kennko card". At that point they confirm
  they are 13 or older and accept the privacy notice. Existing Google users are not silently enrolled.
- **Customers and staff stay separate.** A customer is a signed-in user with a `customers` row. Admin rights come
  only from `staff`.
- **Deleting an account** from the account page is a hard delete in one transaction:
  - The cat, cosmetics owned, visits, stamp cards, stamps and points ledger are removed.
  - `orders.customer_id` and `orders.customer_user_id` are set to null, so sales records stay but no longer point to
    a person.
  - The sign-in user is deleted.
  - The till's next sync drops the customer from its cache and from the wall.
  - The email-matching path that shows guest orders in history (`owns_order()`, migration 0009) must not re-attach
    them if the same email signs up again. It only matches orders placed after the account's `created_at`.

## Recognising a customer at the counter

- **The account page shows a QR code and a typed code** carrying the customer's `public_code`:
  - 8 characters from a 31-symbol alphabet without look-alike characters, plus a check character, for example
    `KC-7F3K-9QXA`.
  - It is not a secret and gives no access to the account. It only says which card to stamp.
- **At the counter:**
  - Staff tap "Add customer" and scan the phone with the tablet camera, or type the code. A bad check character is
    caught on the till, so a typo never reaches someone else's card.
  - **Online**, the till looks the code up and shows the cat name before staff confirm. Lookups are rate-limited
    per device.
  - **Offline**, the till shows the code only ("will confirm when back online"). There is no customer directory on
    the till *(Claude's call)*.
- **Unlinking** is allowed until the shift closes, for a wrong scan. It removes that order's stamp and points.

## Digital stamp card

- **Card state per customer:**
  - `none` → `digital` (the first stamp creates the card) or `paper` (set by a manager).
  - Only a manager changes `paper` back to `digital`.
  - Customers on paper still earn points and have a cat *(Claude's call)*; only the stamp card is affected.
- **Stamping:**
  - On a linked, paid order containing a drink, staff tap "Stamp". There is one stamp per order at most.
  - Online orders by a signed-in customer show "Stamp at pickup" for staff.
  - The till pushes `stamp_added (order_id, stamp_id)` and never names a card. The API finds the customer's open
    card under a lock on the customer's row, creates one if needed, and puts a stamp that would be the 9th onto a
    fresh card. Offline stamping therefore always lands somewhere sensible.
- **A stamp pushed offline for a customer who meanwhile went `paper`** is stored and flagged. The manager applies or
  discards it from a "Needs a look" list in admin *(Claude's call)*.
- **A stamped order cancelled later:**
  - Its stamp is removed from an open card.
  - If that card was already claimed, the stamp is forgiven and only logged *(Claude's call)*.
- **Claiming the free drink:**
  - Needs a full card, a manager PIN and the till **online**.
  - The till sends a claim with a till-generated id. The API marks it claimed with one conditional update (open card,
    8 stamps, not yet claimed), so two claims at once give one success.
  - The order it was used on is attached afterwards through sync.
  - On the till, the claim makes one drink line's base price ₱0, at any size; add-ons stay charged. `priceOrder` in
    `packages/core` gains this line-level reward.
  - The free line earns no stamp and no points. The rest of that order still earns points.
  - Voiding that order in the same shift reopens the card.
- **The account page shows:**
  - **Digital:** 8 stamp circles with dates, and "Free drink ready" when the card is full.
  - **Paper:** "You're on a paper card. Your stamps are on the card in your wallet."

## Points and the cat

- **Earning:**
  - 1 point per ₱10 of the order's paid total, after discounts and excluding a free-drink line, rounded down.
  - Points are credited when **both** the customer link and the payment exist, whichever comes second. A unique
    `(order_id, reason)` makes a second credit impossible.
  - Online orders link only when the customer was signed in at checkout, never through email matching.
- **Reversal:**
  - Cancelling or refunding an order always writes a reversal row, even if the points were already spent. The
    balance may go negative.
  - Only buying a cosmetic requires `balance >= price`.
  - Every ledger write takes the same lock on the customer's row.
- **The cat:**
  - A starter cat and coat; the customer names it.
  - Cosmetic slots: coat, hat, face, neck, held item. One equipped per slot, from those owned.
  - The customer can switch "Show me on the wall" off.
- **Cat names are shown on a projector**, so they are capped at 16 characters, limited to letters, numbers, spaces
  and simple punctuation, and must contain no digit sequence longer than 3 (so no phone numbers). Admin can hide any
  cat from the wall.
- **Art:**
  - The wall already draws its cats in code (`wall/public/scene/sprites.mjs`). Cosmetics are drawn the same way, as
    pixel overlays per slot.
  - The drawing code moves to one plain-JavaScript module, `packages/cats`. The wall serves it as a static file and
    the website imports it, so a cat looks the same in the customiser and on the wall *(Claude's call)*.
  - The database stores only cosmetic keys and prices.

## The cat on the wall

```
Wall (projector)                Customer's phone (signed in)          API
shows QR: kennko.cafe/here      opens the link  ───────────────▶  checks the code,
?c=<code that changes            (sign-in first if needed)          starts or extends the visit (90 min)
 every 60 s, made by the till)                                          │
                         till's next sync pulls active visits  ◀─────────┘
                         wall feed gets each cat's name, look and end time ──▶ the cat walks in
```

- **The code:**
  - Made by the till from **one shop-level secret** it receives in sync, as an HMAC of the minute truncated to at
    least 40 bits.
  - The **till sends the wall only the current code**, never the secret, because the wall feed is open on the LAN.
  - The till generates codes **in server time**, using the offset it measures from the API's `Date` header, so its
    own clock drift doesn't matter.
  - The API accepts the current and the previous minute.
  - Check-ins are rate-limited per user.
- **Visits:**
  - One row per customer; `ends_at` is pushed out to 90 minutes from the latest check-in *(Claude's call)*.
  - A linked counter order also extends the visit, if the customer's "show me on the wall" is on.
- **The wall never talks to the internet.** When the shop is offline, new check-ins wait, and cats already on the
  wall stay until their visit ends.
- **At most 12 visiting cats** at once; the most recent arrivals win *(Claude's call)*.

## Schema (added to the backend design)

```
customers
  id → auth.users (primary key), public_code text unique, display_name
  stamp_mode 'none' | 'digital' | 'paper', stamp_mode_set_by → staff, stamp_mode_set_at
  age_confirmed_at, privacy_accepted_at, privacy_version, created_at

stamp_cards
  id, customer_id → customers, started_at,
  claimed_at, claim_id (till-generated, unique), claimed_order_id → orders, claimed_by_staff → staff
  unique (customer_id) where claimed_at is null       -- one open card per customer

stamps
  id (till- or API-generated), card_id → stamp_cards, order_id → orders unique,   -- one stamp per order
  stamped_by_staff → staff, device_id, stamped_at, received_at
  flags text[]                                        -- 'mode_was_paper', 'forgiven'

orders  (existing)
  + customer_id → customers, nullable, on delete set null

points_ledger
  id, customer_id → customers, delta int, reason ('order','order_reversed','cosmetic','adjustment'),
  order_id, cosmetic_id, created_at, created_by_staff (adjustments only)
  unique (order_id, reason) where order_id is not null

cosmetics
  id, key text unique (matches packages/cats), slot ('coat','hat','face','neck','held'), name,
  price_points check (price_points >= 0), is_starter, is_active, sort_order

customer_cosmetics
  customer_id, cosmetic_id, acquired_at, primary key (customer_id, cosmetic_id)

cats
  customer_id → customers primary key, name, equipped jsonb, show_on_wall, hidden_by_admin, updated_at
  -- the API checks every equipped key is owned and fits its slot

visits
  customer_id → customers primary key, source, started_at, ends_at
  -- upsert: ends_at = greatest(ends_at, now() + 90 minutes)

shop_secrets
  single row: checkin_secret, rotated_at   -- delivered to tills in sync, never to the wall
```

- **Row-level security:** all of these tables deny `anon` and `authenticated` outright. Customers reach their own
  data only through `/v1/me`. No customer-writable policy exists on `cats`, `customer_cosmetics` or
  `points_ledger`.
- **The till's sync gains:**
  - **Push:** `customer_linked (order_id, public_code)`, `customer_unlinked`, `stamp_added (order_id, stamp_id)`,
    `reward_used (claim_id, order_id)`.
  - **Pull:** the check-in secret; active visits as cat name, look and end time only; and, for customers linked in
    the last few minutes, cat name, stamp count and card state.
  - Real names, emails and point balances never go to the till.

## API additions

- `GET /v1/me` (profile, card, points, cat), `PATCH /v1/me`, `DELETE /v1/me`, `POST /v1/me/join` (age and privacy)
- `GET /v1/cosmetics`, `POST /v1/me/cosmetics/:id/buy`, `PUT /v1/me/cat`
- `POST /v1/checkin` (signed-in customer, with the wall code)
- `GET /v1/customers/:publicCode` (till, online, rate-limited)
- `POST /v1/customers/:id/stamp-mode` (manager), `POST /v1/stamp-cards/claim` (till, online, manager PIN)
- Admin: point adjustments (owner, always new ledger rows), hide a cat, the "Needs a look" list, cosmetics catalogue

## Changes to each app

| App | Change |
|---|---|
| `apps/web` | Sign-in with Google or email link; "Get my Kennko card" with age and privacy; account page with QR code, stamp card or paper notice, points, cat customiser and cosmetics shop; check-in page; account deletion; admin: customer lookup, card mode, point adjustments, hide cat, "Needs a look", cosmetics catalogue. |
| `apps/pos` | "Add customer" by camera or typed code with check character; Stamp; unlink; free-drink claim (online, manager PIN) as a ₱0 base price; rotating wall code in server time; visiting cats to the wall feed. |
| `packages/core` | Line-level free-drink reward in `priceOrder`; stamp eligibility (order has a drink); points calculation. |
| `packages/cats` | New, plain JavaScript: cat and cosmetic pixel art and `drawCat` with equipped cosmetics. |
| `wall` | Shows the rotating QR code in a corner; draws visiting cats with their cosmetics and names. |

## Rollout

After the backend design's step 4 (till sync), since stamps and visits travel through it:

1. "Get my Kennko card", sign-in by email link, account page with QR code, account deletion.
2. Counter linking, stamp card and paper mode, points ledger.
3. `packages/cats`, customiser, starter cosmetics, cosmetics shop.
4. Wall check-in and visiting cats.

## Left to the builder

- QR rendering and camera-scanning libraries.
- The privacy notice text (Julius to review).
- The first cosmetics catalogue and prices (Julius to review the art).
- Account page layout, within the sticker style in `brand/DESIGN.md`.
- These must have tests:
  - one stamp per order, and none on food-only orders;
  - a 9th stamp rolling onto a fresh card;
  - one successful claim when two arrive at once;
  - reversal after the points were spent;
  - a purchase refused below the price;
  - an equipped cosmetic that isn't owned is refused;
  - wall code accepted for the current and previous minute only;
  - the check character catching typos;
  - account deletion leaving no row that points to the person;
  - nothing beyond the allowed fields sent to the till or the wall.
