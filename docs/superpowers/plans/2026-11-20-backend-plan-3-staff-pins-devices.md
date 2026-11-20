# Backend Plan 3: Staff Roles and PINs, Devices and Pairing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every person a role and a 6-digit PIN, let the owner pair a till with a one-time code, and let the till exchange a PIN for a session cookie instead of sending the PIN on every request, without ever blocking a sale.

**Architecture:** One migration separates `staff.id` from the website login (`user_id`), adds the `manager` role and PIN columns, and creates `devices`. The API gains owner endpoints for staff, PINs and devices, an unauthenticated pairing endpoint, and a device-token middleware proven by `GET /v1/devices/me`, which also hands the till the active staff PIN hashes. The website's Staff screen moves onto the API and gains a Tills screen. The till gets SQLite-backed sessions (cookie), a pairing card, and a local staff cache it checks PINs against offline; until the cache holds a manager or owner PIN it keeps using the two `config.json` PINs exactly as today.

**Tech Stack:** Hono 4, postgres.js 3, zod 4, jose 6, `node:crypto` scrypt, vitest 4, PGlite harness (`apps/api/test/pg.ts`), Next.js 16, Node 24 + `node:sqlite` (till), React 19.

**Spec:** `docs/superpowers/specs/2026-11-20-kennko-backend-design.md` — sections Schema › Staff and devices, API (auth, endpoints), Migration notes (`staff` bullet), Changes to each app, Rollout order step 4 (first half: staff and PINs, device pairing).

### Where this plan sits

Plans 1, 2 and "ordering nav/receipts/push" are implemented; latest migration is `0015_shop_settings_and_push.sql`. This is roadmap row 3. Plan 4 (till sync) builds on the device token, `requireDevice`, the PIN hash format and the till's staff cache delivered here.

## Global Constraints

- Money is integer centavos everywhere; format only at render with `formatPesos()` from `@kennko/core`.
- Use `type`, never `interface`.
- Imports inside `packages/core` carry `.ts`; relative imports inside `apps/api/src` carry `.js`; `apps/pos` imports carry `.ts`/`.tsx`.
- Text + `check` for role/kind columns; no new Postgres enums (this plan removes `staff_role`).
- Every new table: RLS on, `revoke all … from anon, authenticated`, explicit grants and `to kennko_api` policies. Privilege tests use `has_table_privilege` / `has_column_privilege`, never a literal TRUNCATE.
- The API's database access is role `kennko_api` only; the service-role key stays confined to `apps/api/src/storage.ts`.
- PIN: exactly 6 digits (`/^\d{6}$/`), hashed with scrypt and a per-row 16-byte salt. Stored format (exact): `scrypt$16384$8$1$<salt base64url>$<key base64url>`, key length 32.
- Pairing: 6-digit code, valid 10 minutes (`PAIRING_TTL_MS = 600_000`), burned after 5 wrong attempts (`MAX_PAIRING_ATTEMPTS = 5`). Device token: `kd_` + 32 random bytes base64url; only its SHA-256 hex is stored.
- The device token may call only device routes (`/v1/devices/me` now, `/v1/sync/*` in Plan 4) and the public menu. Staff/owner routes refuse it (401).
- A sale is never blocked by the network: nothing on the till waits on the API except pairing itself.
- API error bodies: `{ code: string, message: string }` via `apiError` (staff/device routes); the website shows `message`.
- No new environment variables. No new runtime dependencies (scrypt and SHA-256 come from `node:crypto`).
- Run `npm test` and `npm run typecheck` from the repo root before every commit.

## Rulings made while planning (Claude's calls)

1. **`shifts` and `cash_moves` are created in Plan 4, not here.** Nothing in this plan writes them; Plan 4 creates them together with `orders.device_id/shift_id/opened_by_staff` and the push handler that fills them, so their shape is tested against real sync events.
2. **`staff.id` keeps its value for existing rows; `user_id` is backfilled from it.** The `staff.id → auth.users` FK is dropped, `id` gets `default gen_random_uuid()`, `user_id` is `unique references auth.users on delete set null`. Every existing FK to `staff(id)` keeps pointing at the same person, and the old API/website keep working for existing staff until they redeploy.
3. **Roles:** `owner` must have a website login (`check (role <> 'owner' or user_id is not null)`); `manager` may have one; `barista` is added without one (existing baristas keep theirs). On the website a manager has barista-level access; owner-only stays owner-only.
4. **Staff writes move to the API.** `authenticated` loses insert/update on `staff` and keeps column-level select without `pin_hash`. The website still sends the invite email for an owner/manager login (Supabase auth admin needs its service key), then creates the staff row with `POST /v1/staff`.
5. **PINs are generated, not chosen.** `POST /v1/staff/:id/pin` returns a fresh random PIN once; the owner tells the person. The API regenerates until it matches no other active person's hash, so a PIN always identifies exactly one person (the till has no username field). All-same-digit PINs and `123456`/`654321` are never issued.
6. **Reactivating a person clears their PIN**, so a PIN issued to someone else meanwhile cannot collide.
7. **Pairing attempts count across all pending codes.** A wrong code cannot say which device it was meant for, so every failed `POST /v1/devices/pair` adds one attempt to every unexpired pending code. With the normal single pending code this is exactly "5 wrong attempts burn it". `paired_by` records the owner who issued the code.
8. **The till gets PIN hashes from `GET /v1/devices/me` until Plan 4's pull exists.** The response carries active staff with a PIN set (`id, fullName, role, pinHash`). Plan 4 moves the refresh into the pull loop and may drop `staff` from this route.
9. **Till PIN mode:** `per-person` once its staff cache holds at least one owner or manager PIN; otherwise `shared` (today's `staffPin`/`managerPin` from `config.json`), or `off` when `staffPin` is `""`. So upgrading, and even pairing, changes nothing at the counter until the owner has issued PINs. Voids, cash out, closing and menu update need an owner/manager PIN in per-person mode (as the manager PIN today).
10. **A revoked till keeps selling** with its cached PINs; it only loses API access and shows "Disconnected in admin". Deactivated people drop out of the cache on the next refresh (every 5 minutes when online) and their till sessions end.
11. **Till sessions live in SQLite** (token SHA-256, who, role), cookie `kennko_pos_session`, `HttpOnly; SameSite=Strict; Path=/` (+ `Secure` on the https port), no `Max-Age`, and expire 16 hours after start (`SESSION_MS`). They survive a till restart; Lock ends them. A browser-session cookie is per browser, the closest a cookie gets to "per tab".
12. **Deferred to Plan 4:** crediting voids/cash moves/closes to a person on the till and in Postgres, the PIN prompt for sold-out changes (it only means something once sold-out marks sync), and the till's clock check.

## Review Focus

1. **Someone guesses pairing codes:** after 5 wrong codes the right code no longer works; a code at exactly 10 minutes is expired; two tills sending the same right code at once get exactly one token. Test in Task 4.
2. **A revoked or stolen device token** is refused on its next request, and a device token sent to staff/owner routes gets 401, never data. Test in Task 4 (and Task 3 for staff routes).
3. **The owner locks themselves out:** demoting or deactivating the last active owner is refused (409 `LAST_OWNER`); an owner without a login cannot be created. Test in Task 5.
4. **The till is offline or the API is down** when a barista arrives: the gate still opens from the staff cache (per-person) or `config.json` (shared), and a session made before a till restart still works. Test in Tasks 8 and 9.
5. **Existing logins after the migration:** the current owner still signs in on the website and the API, and a person whose `staff.id` differs from their `user_id` is credited by `staff.id` (e.g. `menu_snapshots.published_by`). Test in Tasks 2 and 3.

---

### Task 1: Staff PIN hashing in core

**Files:**
- Create: `packages/core/src/staff-pin.ts`, `packages/core/src/staff-pin.test.ts`
- Modify: `packages/core/package.json` (exports `"./staff-pin": "./src/staff-pin.ts"`). Not exported from `index.ts`: it imports `node:crypto`, and the website bundles `index.ts` for the browser.

**Interfaces:**
- Produces (`@kennko/core/staff-pin`, Node only):
  - `isStaffPin(pin: unknown): pin is string` — `/^\d{6}$/`
  - `hashStaffPin(pin: string): Promise<string>` — format in Global Constraints; throws on a non-PIN
  - `checkStaffPin(pin: string, stored: string): Promise<boolean>` — parses N/r/p/salt from `stored`, `timingSafeEqual`; malformed `stored` or non-PIN input → `false`, never throws
  - `randomStaffPin(): string` — `crypto.randomInt`, 6 digits zero-padded, never all-same digits, `123456` or `654321`

- [ ] **Step 1: Write the failing tests**

```ts
test('hash then check', async () => {
  const h = await hashStaffPin('482913')
  expect(h).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/)
  expect(await checkStaffPin('482913', h)).toBe(true)
  expect(await checkStaffPin('482914', h)).toBe(false)
})
test('same PIN, different salt', async () => {
  expect(await hashStaffPin('111222')).not.toBe(await hashStaffPin('111222'))
})
test('bad input never throws', async () => {
  expect(await checkStaffPin('48291', await hashStaffPin('482913'))).toBe(false)
  expect(await checkStaffPin('482913', 'garbage')).toBe(false)
  expect(await checkStaffPin('482913', 'scrypt$1$1$1$a$b')).toBe(false)
  await expect(hashStaffPin('12345a')).rejects.toThrow()
})
test('random PINs are valid and never trivial', () => {
  for (let i = 0; i < 2000; i++) {
    const p = randomStaffPin()
    expect(isStaffPin(p)).toBe(true)
    expect(/^(\d)\1{5}$/.test(p) || p === '123456' || p === '654321').toBe(false)
  }
})
```

- [ ] **Step 2: Run** `npm test -w @kennko/core -- staff-pin` — FAIL (module missing).
- [ ] **Step 3: Implement** with promisified `crypto.scrypt(pin, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })`. Reject stored params outside `N ∈ [16384, 2^20]`, `r ∈ [1, 16]`, `p ∈ [1, 4]` (returns false) so a tampered hash cannot make the till burn memory.
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(core): staff PIN hashing (scrypt, per-row salt)`

---

### Task 2: Migration 0016 — staff logins, roles, PINs; devices

**Files:**
- Create: `apps/api/supabase/migrations/0016_staff_pins_and_devices.sql`, `apps/api/test/staff-schema.test.ts`

**Interfaces:**
- Produces (names exact):

```
staff:   id  default gen_random_uuid()   (FK staff_id_fkey → auth.users dropped; values kept)
         user_id uuid unique references auth.users(id) on delete set null   -- backfilled = id
         email   nullable (still unique)
         role    text not null default 'barista', check staff_role_check (role in ('owner','manager','barista'))
                 (converted from the enum; type staff_role dropped)
         check staff_owner_has_login (role <> 'owner' or user_id is not null)
         pin_hash text, pin_updated_at timestamptz, updated_at timestamptz not null default now()
devices: id uuid pk default gen_random_uuid(), name text not null check (char_length(name) between 1 and 40),
         ticket_series text not null default 'C' check (ticket_series = 'C'),
         token_hash text unique, pairing_code_hash text, pairing_expires_at timestamptz,
         pairing_attempts int not null default 0 check (pairing_attempts >= 0),
         paired_at timestamptz, paired_by uuid references staff(id), last_seen_at timestamptz, revoked_at timestamptz,
         created_at, updated_at timestamptz not null default now()
         unique index devices_pending_code (pairing_code_hash) where pairing_code_hash is not null
```

- `is_active_staff()` and `is_owner()` recreated with `where user_id = auth.uid()` (same security definer + search_path). Policy `"staff read own row or owner reads all"` recreated with `user_id = auth.uid() or public.is_owner()`. Policies `"owner inserts staff"` and `"owner updates staff"` dropped (Ruling 4).
- Grants: `revoke select, insert, update on staff from authenticated`; `grant select (id, user_id, email, full_name, role, is_active, created_at, pin_updated_at) on staff to authenticated`. `kennko_api`: `select, insert, update on staff` (+ policies `api inserts staff`, `api updates staff`), `select, insert, update on devices` (+ one policy per command). `devices`: RLS on, `revoke all from anon, authenticated`.

- [ ] **Step 1: Write `staff-schema.test.ts`** with `startTestDb({ seedBefore: { migration: '0016', sql: LEGACY } })`, where `LEGACY` inserts `auth.users` + staff for an owner and a barista the old way (`id` = user id). Assertions:
  - after migration both rows have `user_id = id`; `role` is `text` (`pg_typeof`), and `select 1 from pg_type where typname = 'staff_role'` is empty;
  - `asUser(ownerId)`: `is_owner()` true, `is_active_staff()` true; `asUser(baristaId)`: `is_owner()` false;
  - a new barista inserted with no `id`, no `user_id`, no email succeeds and gets a fresh uuid; an owner with `user_id` null fails `staff_owner_has_login`; role `'chef'` fails `staff_role_check`;
  - **Review Focus 5:** an owner row whose `id` ≠ `user_id` (`insert … (id, user_id, …)`) → `asUser(userId)` sees `is_owner()` true and can select their own row;
  - `has_column_privilege('authenticated', 'staff', 'pin_hash', 'SELECT')` false, `'full_name'` true; `has_table_privilege('authenticated', 'staff', 'INSERT')` and `'UPDATE'` false; `has_table_privilege('kennko_api', 'staff', 'UPDATE')` true;
  - `devices`: `has_table_privilege` false for `anon` and `authenticated` on SELECT; true for `kennko_api` on SELECT/INSERT/UPDATE, false on DELETE; two rows with the same non-null `pairing_code_hash` fail `devices_pending_code`; two with null succeed.
- [ ] **Step 2: Run** `npm test -w @kennko/api -- staff-schema` — FAIL.
- [ ] **Step 3: Write the migration.** Order: drop `staff_id_fkey` → add `user_id`, backfill, unique + FK → `role` drop default, `type text using role::text`, set default, check, `drop type staff_role` → email `drop not null` → PIN/updated_at columns → owner check → functions and policies → grants → `devices` + policies.
- [ ] **Step 4: Run** root `npm test` (every existing API test still passes: `requireStaff` still matches `id`, which equals `user_id` for rows inserted the old way) and `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(api): migration 0016 — staff logins, manager role, PINs, devices`

---

### Task 3: API auth — staff by login, manager role, device tokens

**Files:**
- Create: `apps/api/src/devices/tokens.ts`, `apps/api/test/device-auth.test.ts`
- Modify: `apps/api/src/auth.ts`, `apps/api/test/auth.test.ts`, and the staff seed in every test that inserts staff (`grep -rln "insert into staff" apps/api/test`: add `user_id` = the same id)

**Interfaces:**
- Produces:
  - `auth.ts`: `type StaffRole = 'owner' | 'manager' | 'barista'`. `requireStaff(deps, role?: 'owner')` looks up `select id, role, is_active from staff where user_id = $sub` and sets `c.var.staff = { id: <staff.id>, role }`. Signature unchanged.
  - `AppEnv.Variables` gains `device: { id: string; name: string }`.
  - `requireDevice(deps): MiddlewareHandler<AppEnv>` — `Authorization: Bearer kd_…`; anything else → 401 `UNAUTHENTICATED`; `select id, name from devices where token_hash = sha256Hex(token) and revoked_at is null` → none → 401 `DEVICE_REVOKED` ("This till was disconnected. Pair it again."); then `update devices set last_seen_at = $now where id = $id and (last_seen_at is null or last_seen_at < $now - interval '1 minute')`.
  - `devices/tokens.ts`: `sha256Hex(text: string): string`, `newDeviceToken(): string` (`kd_` + 32 random bytes base64url), `newPairingCode(): string` (`randomInt(0, 1_000_000)` padded to 6).

- [ ] **Step 1: Write the failing tests.** In `auth.test.ts` add a manager (`/any-staff` → 200 `{ role: 'manager' }`, `/owner-only` → 403) and **Review Focus 5**: an owner with `staff.id = S`, `user_id = U`; a JWT with `sub = U` on `/owner-only` → 200 `{ id: S }`, and publishing the menu with that token stores `published_by = S`. A JWT whose `sub` matches a staff `id` but not any `user_id` → 403. In `device-auth.test.ts` (mount `app.get('/device-only', requireDevice(deps), c => c.json(c.get('device')))`, insert a device with `token_hash = sha256Hex(T)`):
  - `Bearer T` → 200 `{ id, name }` and `last_seen_at` set; a second call within a minute leaves `last_seen_at` unchanged;
  - set `revoked_at` → next call 401 `DEVICE_REVOKED`;
  - no header, `Bearer not-a-device`, `Bearer kd_unknown` → 401;
  - **Review Focus 2:** `Bearer T` on `/owner-only` and on `POST /v1/menu/publish` → 401 (not a JWT).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**; update the test staff seeds.
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(api): staff found by login, manager role, device-token middleware`

---

### Task 4: Devices and pairing endpoints

**Files:**
- Create: `apps/api/src/devices/pairing.ts`, `apps/api/src/routes/devices.ts`, `apps/api/test/devices.test.ts`
- Modify: `apps/api/src/create-app.ts` (`app.route('/v1/devices', deviceRoutes(deps))`), `apps/api/README.md` (endpoint list)

**Interfaces:**
- Consumes: Task 3 `requireStaff`, `requireDevice`, `tokens.ts`; `deps.now()` for every time comparison (pass it as a parameter, never SQL `now()`, so tests pin the clock).
- Produces:
  - `POST /v1/devices` (owner) body `{ name: string }` (trimmed, 1–40) → 201 `{ id, name, code, expiresAt }` (ISO). Inserts `pairing_code_hash = sha256Hex(code)`, `pairing_expires_at = now + PAIRING_TTL_MS`, `paired_by = staff.id`. A unique violation on `devices_pending_code` regenerates the code (max 5 tries).
  - `GET /v1/devices` (owner) → `{ devices: { id, name, status: 'waiting' | 'expired' | 'paired', expiresAt: string | null, pairedAt: string | null, lastSeenAt: string | null }[] }`, non-revoked only, newest first. `expired` = unpaired and (`pairing_code_hash` null or `pairing_expires_at <= now`). Never returns hashes.
  - `DELETE /v1/devices/:id` (owner) → 204; sets `revoked_at = now`, `token_hash = null`, `pairing_code_hash = null`. Already revoked → 204. Unknown or malformed id → 404 `NOT_FOUND`.
  - `POST /v1/devices/pair` (no auth) body `{ code: string }` (`/^\d{6}$/`, else 400 `INVALID`) → `pairDevice(sql, code, now): Promise<{ deviceId: string; name: string; ticketSeries: 'C'; token: string } | null>` in `pairing.ts`: one statement `update devices set token_hash = $th, pairing_code_hash = null, paired_at = $now, pairing_attempts = 0 where pairing_code_hash = $ch and pairing_expires_at > $now and paired_at is null and revoked_at is null returning id, name, ticket_series`. No row → `update devices set pairing_attempts = pairing_attempts + 1, pairing_code_hash = case when pairing_attempts + 1 >= 5 then null else pairing_code_hash end where pairing_code_hash is not null and pairing_expires_at > $now` (Ruling 7) and the route answers 401 `PAIRING_FAILED` "That code is wrong or has expired. Ask the owner for a new one." Success → 200 with the result.
  - `GET /v1/devices/me` (`requireDevice`) → `{ device: { id, name, ticketSeries: 'C' }, staff: { id, fullName, role, pinHash }[] }` — `is_active and pin_hash is not null` only, ordered by `full_name` (Ruling 8).

- [ ] **Step 1: Write `devices.test.ts`** (owner and barista JWTs as in `menu-routes.test.ts`; `now` is a mutable test clock):
  - owner adds "Counter till" → 201, `code` matches `/^\d{6}$/`, `expiresAt` = now + 10 min; the row stores `sha256Hex(code)` and no plain code anywhere (`select * from devices` contains no column equal to the code); barista → 403;
  - pair with the code → 200 with `token` starting `kd_`; row has `token_hash = sha256Hex(token)`, `pairing_code_hash` null, `paired_at` set; `GET /v1/devices/me` with the token → 200 with the device and only active staff that have a PIN (seed one active with PIN, one active without, one inactive with PIN → exactly one);
  - **Review Focus 1:** 4 wrong codes then the right one → 200; with a fresh device, 5 wrong codes then the right one → 401 and `pairing_code_hash` is null; advance the clock to exactly `expiresAt` → 401; the right code twice in a row → first 200, second 401 (one token); `Promise.all` of two pairs with the same code → exactly one 200 (sequential on PGlite, but the single conditional `update … returning` is the guarantee);
  - **Review Focus 2:** revoke → 204, the same token on `/v1/devices/me` → 401 `DEVICE_REVOKED`; revoke again → 204; revoke an unknown uuid → 404; `GET /v1/devices` no longer lists it;
  - list statuses: one waiting, one expired by clock, one paired, with `lastSeenAt` after a `/me` call;
  - bad bodies: `{ code: '12345' }` → 400; `{ name: '' }` → 400.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(api): device pairing, listing, revoking and /v1/devices/me`

---

### Task 5: Staff and PIN management endpoints

**Files:**
- Create: `apps/api/src/staff/manage.ts`, `apps/api/src/routes/staff.ts`, `apps/api/test/staff.test.ts`
- Modify: `apps/api/src/create-app.ts` (`app.route('/v1/staff', staffRoutes(deps))`), `apps/api/README.md`

**Interfaces:**
- Consumes: Task 1 `hashStaffPin`, `checkStaffPin`, `randomStaffPin`; Task 3 `requireStaff(deps, 'owner')` on every route.
- Produces:
  - `type StaffView = { id: string; fullName: string; email: string | null; role: StaffRole; isActive: boolean; hasLogin: boolean; pinSet: boolean; pinUpdatedAt: string | null }`
  - `GET /v1/staff` → `{ staff: StaffView[] }` ordered by `created_at`. Never includes `pin_hash` or `user_id`.
  - `POST /v1/staff` body `{ fullName: string (trim, 1–80); role: StaffRole; userId?: uuid; email?: email }` → 201 `StaffView`. `role 'owner'` without `userId` → 409 `NEEDS_LOGIN`; `userId` already on a staff row → 409 `ALREADY_STAFF`; `userId` not in `auth.users` → 400 `INVALID`.
  - `PATCH /v1/staff/:id` body `{ fullName?; role?; isActive? }` (at least one) → 200 `StaffView`. In one transaction with `select … from staff where is_active and role = 'owner' for update`: an update leaving zero active owners → 409 `LAST_OWNER` "There must always be at least one active owner."; `role 'owner'` on a row without a login → 409 `NEEDS_LOGIN`; `isActive` false → true sets `pin_hash = null, pin_updated_at = null` (Ruling 6). Unknown id → 404.
  - `POST /v1/staff/:id/pin` → 201 `{ pin: string }`. Inactive → 409 `INACTIVE`. `issuePin(sql, staffId): Promise<string>` in `manage.ts`: up to 10 tries of `randomStaffPin()`, rejecting one for which `checkStaffPin` matches any other active staff's `pin_hash`; then stores `hashStaffPin(pin)` and `pin_updated_at = now`. The PIN is in the response only, never logged.

- [ ] **Step 1: Write `staff.test.ts`:**
  - add a barista with no login → 201 `{ hasLogin: false, pinSet: false, email: null }`; add a manager with `userId` + email → `hasLogin: true`; owner without `userId` → 409 `NEEDS_LOGIN`; the same `userId` twice → 409 `ALREADY_STAFF`; barista JWT on every route → 403;
  - issue a PIN → 201, `/^\d{6}$/`, `checkStaffPin(pin, row.pin_hash)` true, `GET` shows `pinSet: true` and no `pin_hash` key anywhere in the JSON; issue again → a different hash;
  - uniqueness: stub `randomStaffPin` (inject via `vi.mock('@kennko/core/staff-pin', …)` with the real hash/check) to return the other person's PIN first, then `'507318'` → result `'507318'`;
  - **Review Focus 3:** with one active owner, `PATCH { role: 'barista' }` and `PATCH { isActive: false }` on that owner → 409 `LAST_OWNER`, row unchanged; with two owners, deactivating one → 200; promoting a no-login barista to owner → 409 `NEEDS_LOGIN`;
  - deactivate then reactivate a barista with a PIN → `pinSet: false`; issuing a PIN to an inactive person → 409 `INACTIVE`;
  - empty PATCH body → 400; unknown id → 404.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` + `npm run build -w @kennko/api` (the bundle must include `@kennko/core/staff-pin`; load it with dummy env as in earlier plans) — PASS.
- [ ] **Step 5: Commit** `feat(api): staff roles and PIN management for the owner`

---

### Task 6: Website — sign-in by login, Staff screen through the API

**Files:**
- Modify: `apps/web/lib/auth/types.ts`, `apps/web/lib/auth/session.ts` (+ its test if present), `apps/web/lib/email/send.ts` (`activeStaffEmails`), `apps/web/scripts/create-owner.ts`, `apps/web/app/admin/staff/actions.ts`, `apps/web/app/admin/staff/page.tsx`, `apps/web/components/admin/StaffRow.tsx`, `apps/web/CLAUDE.md` (Admin capability table: Manager column, barista PINs)
- Create: `apps/web/app/admin/staff/actions.test.ts`
- Delete: `apps/web/app/admin/staff/guards.ts`, `guards.test.ts` (the last-owner rule now lives in the API, Task 5)

**Interfaces:**
- Consumes: Task 5 routes; `staffFetch` from `lib/api/client.ts`.
- Produces:
  - `StaffRole = 'owner' | 'manager' | 'barista'`; `StaffMember.email: string | null`.
  - `getCurrentStaff()` selects `id, email, full_name, role, is_active` `.eq('user_id', user.id)`.
  - `activeStaffEmails()` adds `.not('email', 'is', null)`.
  - `create-owner.ts` inserts `user_id: created.user.id` (and no `id`).
  - Actions (all `requireOwner()`, return `{ ok: true } | { ok: false; message: string }`, `revalidatePath('/admin/staff')`, never write `staff` through Supabase):
    `addStaff(formData)` — `full_name`, `role`, `email`. Barista: email ignored, `POST /v1/staff`. Manager with email or owner (email required): `inviteUserByEmail` as today, then `POST /v1/staff { fullName, role, email, userId }`.
    `updateStaff(id, patch: { fullName?: string; role?: StaffRole; isActive?: boolean })` → `PATCH /v1/staff/:id`.
    `issuePin(id): Promise<{ ok: true; pin: string } | { ok: false; message: string }>` → `POST /v1/staff/:id/pin`.
    API 409 → the API's `message`; unreachable → `Couldn't reach the server. Try again.`
  - Page reads `GET /v1/staff` through `staffFetch` (no Supabase read). Add form: name, role select (Barista / Manager / Owner), email field shown only for Manager (optional) and Owner (required), copy "Baristas don't need an email. Give them a PIN for the till." Each row: name, role select, "Website login" yes/no, PIN status ("PIN set 20 Nov" / "No PIN"), **Set PIN** / **New PIN**, **Deactivate** / **Reactivate**. After issuing, the row shows the PIN once in a large monospace box: "Tell {name} their till PIN: 482 913. It won't be shown again." with a **Done** button that hides it.

- [ ] **Step 1: Write `actions.test.ts`** (mock `staffFetch`, `getAdminClient`, `requireOwner`, `revalidatePath` as `apps/web/app/admin/orders/actions.test.ts` does): adding a barista calls `POST /v1/staff` with no `email`/`userId` and never calls `inviteUserByEmail`; adding an owner without email → `{ ok: false }` with no fetch; adding a manager with email invites then posts the returned user id; a 409 `LAST_OWNER` from `updateStaff` returns the API's message; `issuePin` returns the PIN from the body; the Supabase server client's `from('staff')` is never called with `insert`/`update`. Update the `session.ts` test (or add one) for `.eq('user_id', …)`.
- [ ] **Step 2: Run** `npm test -w @kennko/web -- staff` — FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` + `KENNKO_API_URL= npm run build -w @kennko/web` — PASS. Check the Staff page at 375 and 1024 px.
- [ ] **Step 5: Commit** `feat(web): staff screen through the API with managers and till PINs`

---

### Task 7: Website — Tills screen

**Files:**
- Create: `apps/web/app/admin/devices/page.tsx`, `apps/web/app/admin/devices/actions.ts`, `apps/web/app/admin/devices/actions.test.ts`, `apps/web/components/admin/AddTill.tsx`, `apps/web/components/admin/DeviceRow.tsx`
- Modify: `apps/web/components/admin/AdminNav.tsx` (+ `AdminNav.test.tsx`), `apps/web/app/admin/admin.css`

**Interfaces:**
- Consumes: Task 4 routes; `staffFetch`.
- Produces:
  - Nav link `{ href: '/admin/devices', label: 'Tills', ownerOnly: true }` after Staff.
  - Actions (`requireOwner()`, same result shape and error copy as Task 6): `addTill(name: string): Promise<{ ok: true; code: string; expiresAt: string } | { ok: false; message: string }>` → `POST /v1/devices`; `revokeTill(id: string)` → `DELETE /v1/devices/:id`.
  - Page (owner only; reads `GET /v1/devices`): **Add a till** card (name input, default "Counter till"). On success `AddTill` shows the code as `482 913` in large digits, a live countdown "Valid for 9:41", and the steps "On the till, open **Menu › Connect this till** and type this code." When the countdown hits 0 it shows "This code has expired. Add the till again." Below, one `DeviceRow` per till: name, status ("Waiting for the code", "Code expired", "Connected · last seen 3 min ago" / "Connected · not seen yet"), and **Disconnect** (`window.confirm('Disconnect {name}? It keeps selling, but stops syncing until it is paired again.')`). Expired rows show **Remove** (same revoke action).

- [ ] **Step 1: Write tests:** `actions.test.ts` — `addTill` posts `{ name }` and returns the code; a 403 maps to `Only the owner can add tills.`; `revokeTill` sends `DELETE`. `AdminNav.test.tsx` — owners see "Tills", baristas and managers do not.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (brand blue `#0055FF` for the code box border, amber for the countdown when under 1 minute; no dark styles).
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` + web build — PASS. Check at 375 and 1024 px.
- [ ] **Step 5: Commit** `feat(web): tills screen to pair and disconnect devices`

---

### Task 8: Till — a session cookie instead of the PIN on every request

**Files:**
- Create: `apps/pos/server/sessions.ts`, `apps/pos/server/pins.ts`, `apps/pos/test/sessions.test.ts`, `apps/pos/test/pins.test.ts`
- Modify: `apps/pos/server/store.ts` (table `sessions`; expose `db` on the returned store), `apps/pos/server/index.ts`, `apps/pos/src/api.ts`, `apps/pos/src/App.tsx`, `apps/pos/src/screens/Gate.tsx`, `apps/pos/src/screens/History.tsx` (CSV link)

**Interfaces:**
- Produces:
  - `sessions.ts`: `type Who = { staffId: string | null; name: string | null; role: 'staff' | 'manager' }`; `SESSION_MS = 16 * 60 * 60 * 1000`; `createSessions(db: DatabaseSync, now: () => number)` → `{ start(who: Who): string; get(token: string | undefined): Who | null; end(token: string | undefined): void; keepOnly(keep: (who: Who) => boolean): void }`. Table `sessions (token_hash text primary key, staff_id text, staff_name text, role text not null, created_at integer not null)`; `get` returns null past `created_at + SESSION_MS` and deletes the row. `sessionCookie(token: string | null, secure: boolean): string` and `readSessionCookie(header: string | undefined): string | undefined`.
  - `pins.ts`: `type PinMode = 'off' | 'shared' | 'per-person'`; `type CachedStaff = { id: string; fullName: string; role: 'owner' | 'manager' | 'barista'; pinHash: string }`; `createPinDirectory(opts: { staffPin: string; managerPin: string; staff: () => CachedStaff[] })` → `{ mode(): PinMode; checkGate(pin: string): Promise<Who | null>; checkManager(pin: string): Promise<Who | null> }`. In this task `index.ts` passes `staff: () => []`, so only `off`/`shared` occur (Task 9 adds `per-person`). Shared mode: `checkGate` accepts `staffPin` or `managerPin` (role accordingly, `staffId`/`name` null); `checkManager` accepts `managerPin` only.
  - `index.ts`: `POST /api/session { pin }` → `checkGate` → `Set-Cookie` + `{ role, name }`; `GET /api/session` → `{ role, name }` or 401; `POST /api/session/end` → ends it, clears the cookie. `/api/pin`, the `x-pin` header and `?pin=` are removed. Every other `/api/*` route except `/api/bootstrap`, `/api/wall/events` and the session routes needs a live session unless `mode()` is `off`. Manager actions keep `body.managerPin`, now `await checkManager(...)`. The per-IP strike lockout (8 wrong → 5 minutes) wraps both checks unchanged. `Secure` is set on the cookie when the request came in on the https server.
  - Bootstrap: `pinRequired` replaced by `pinMode: PinMode`.
  - Client: `api.ts` drops `getPin`/`setPin` and removes the old `kennko-pos-pin` localStorage key on load; adds `startSession(pin)`, `session()`, `endSession()`; `eventsUrl()` and `csvUrl(day)` lose the PIN. `App` on start: `pinMode === 'off'` → unlocked; else `api.session()` → unlocked, 401 → Gate. Lock calls `endSession()`. When the `EventSource` errors with `readyState === EventSource.CLOSED` (a 401 closes it for good), call `api.session()`: 401 → Gate, otherwise reopen the stream after 2 s.

- [ ] **Step 1: Write the failing tests:**
  - `sessions.test.ts` (in-memory `createStore(':memory:')`): `start` returns a 43-char base64url token; the table holds only its SHA-256, never the token; `get` returns the `Who`; at `created_at + SESSION_MS` it returns null; `end` removes it; **Review Focus 4:** a session started on one store survives closing and reopening the same database file (use a temp file); `keepOnly(w => w.staffId !== null)` ends only shared sessions; `readSessionCookie('a=1; kennko_pos_session=abc')` → `'abc'`; `sessionCookie('abc', true)` contains `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` and no `Max-Age`; `sessionCookie(null, false)` expires the cookie.
  - `pins.test.ts`: shared mode with `staffPin '1234'`, `managerPin '0000'`: gate `'1234'` → `{ role: 'staff' }`, `'0000'` → `{ role: 'manager' }`, `'9999'` → null; `checkManager('1234')` → null; `staffPin ''` → `mode()` `'off'`.
- [ ] **Step 2: Run** `npm test -w @kennko/pos` — FAIL. **Step 3: Implement** server and client.
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` + `npm run build -w @kennko/pos` — PASS. Manual check with `npm run pos`: unlock, reload the page (no PIN asked), restart the server and reload (no PIN asked), Lock (PIN asked), the History CSV link downloads, a void still asks the manager PIN.
- [ ] **Step 5: Commit** `feat(pos): PIN typed once and exchanged for a session cookie`

---

### Task 9: Till — pairing and per-person PINs

**Files:**
- Create: `apps/pos/server/device.ts`, `apps/pos/test/device.test.ts`, `apps/pos/src/components/ConnectTill.tsx`
- Modify: `apps/pos/server/store.ts` (table `staff_cache`, `staffCache()`, `replaceStaffCache()`), `apps/pos/server/pins.ts`, `apps/pos/server/index.ts`, `apps/pos/src/api.ts`, `apps/pos/src/screens/MenuScreen.tsx`, `apps/pos/src/screens/Gate.tsx`, `apps/pos/src/App.tsx`, `apps/pos/README.md` (pairing, PIN modes, `data/device.json`, which `.gitignore` already covers through `/apps/pos/data/`)

**Interfaces:**
- Consumes: Task 4 `POST /v1/devices/pair` and `GET /v1/devices/me` contracts; Task 1 `checkStaffPin`; Task 8 `createPinDirectory`, sessions.
- Produces:
  - `device.ts`: `type DeviceFile = { deviceId: string; name: string; token: string; pairedAt: number; revokedAt: number | null }`; `loadDevice(dataDir): DeviceFile | null`; `saveDevice(dataDir, d: DeviceFile): void` (tmp + rename, mode `0o600`); `forgetDevice(dataDir): void`; `pairWithApi(apiUrl: string, code: string, now: number, fetchFn = fetch): Promise<DeviceFile>` (15 s timeout; 401 → `Error('That code is wrong or has expired. Ask the owner for a new one in admin › Tills.')`, network → `Error('Could not reach the website. Check the internet and try again.')`, no `apiUrl` → `Error('The website connection is not set up on this computer.')`); `fetchDeviceInfo(apiUrl: string, token: string, fetchFn = fetch): Promise<{ status: 'ok'; staff: CachedStaff[] } | { status: 'revoked' } | { status: 'offline' }>` (401 → revoked; network, timeout or 5xx → offline).
  - `store.ts`: `staff_cache (id text primary key, full_name text not null, role text not null, pin_hash text not null)`; `staffCache(): CachedStaff[]`; `replaceStaffCache(rows: CachedStaff[]): void` (one transaction).
  - `pins.ts`: `mode()` is `per-person` when `staff()` has an `owner` or `manager` (Ruling 9). Per-person `checkGate(pin)`: `isStaffPin`, then `checkStaffPin` against each cached hash (async, stop at the first match) → `{ staffId, name: fullName, role: barista ? 'staff' : 'manager' }`; `checkManager` only matches owner/manager rows. Config PINs are ignored in this mode.
  - `index.ts`: `refreshStaff()` runs at startup, every 5 minutes (`unref`), and right after pairing; does nothing when unpaired or already revoked. `ok` → `replaceStaffCache`, then `sessions.keepOnly(w => w.staffId === null ? mode() !== 'per-person' : ids.has(w.staffId))` (shared sessions end when per-person turns on; sessions of people no longer in the cache end), then `broadcast()`. `revoked` → `saveDevice({ …, revokedAt: now })` (cache kept, Ruling 10). `offline` → nothing. Routes (session + `checkManager(body.managerPin)`): `POST /api/device/pair { code, managerPin }` → `pairWithApi`, `saveDevice`, `await refreshStaff()`, returns `{ name }`; `POST /api/device/forget { managerPin }` → `forgetDevice` (cache kept). Bootstrap gains `device: { name: string; revoked: boolean } | null`.
  - Client: `MenuScreen` gains a **This till** card: unpaired → "Not connected to Kennko" + **Connect this till**; paired → "Connected as {name}"; revoked → amber "Disconnected in admin. Connect again with a new code." + **Connect this till**. `ConnectTill` is a `Modal` with a 6-digit code keypad, then the existing `PinPrompt` (manager PIN), then calls `api.pairDevice(code, managerPin)`; errors show in the modal. Gate in per-person mode shows 6 dots and "Enter your own 6-digit PIN"; the rail shows the signed-in first name above Lock.

- [ ] **Step 1: Write `device.test.ts`** (fake `fetch`, temp data dir, `createStore(':memory:')`):
  - `pairWithApi` posts `{ code }` to `<url>/v1/devices/pair` and returns the file shape; 401 and a thrown fetch give the two messages; `saveDevice` then `loadDevice` round-trips and the file mode is `0o600` (skip the mode check on win32);
  - `fetchDeviceInfo` sends `Authorization: Bearer kd_…`; 200 → `ok` with staff; 401 → `revoked`; thrown fetch and 503 → `offline`;
  - pins per-person (cache one barista `111111` and one manager `222222`, hashed with `hashStaffPin`): `mode()` `'per-person'`; gate `'111111'` → `{ staffId: <barista>, role: 'staff', name: 'Bea' }`; gate `'1234'` (the config PIN) → null; `checkManager('111111')` → null, `checkManager('222222')` → manager; a cache with only baristas → `mode()` `'shared'`;
  - **Review Focus 4:** with the cache filled and `fetchDeviceInfo` returning `offline`, `checkGate('111111')` still succeeds (no network involved); a refresh that drops the barista ends the barista's session and keeps the manager's; a refresh that turns per-person on ends a shared session.
- [ ] **Step 2: Run** `npm test -w @kennko/pos` — FAIL. **Step 3: Implement.** Keep the refresh-and-reconcile logic in a function in `device.ts` (`applyDeviceInfo(store, sessions, pins, result, dataDir, now)`) so the tests above cover it without starting the server.
- [ ] **Step 4: Run** root `npm test` + `npm run typecheck` + `npm run build -w @kennko/pos` — PASS. Manual check against a local API (`npm run dev -w @kennko/api` with PGlite or a dev database) if one is available; otherwise note it for the deploy checklist.
- [ ] **Step 5: Commit** `feat(pos): pair the till and check each person's PIN offline`

---

### Task 10: Deploy checklist

**Files:** `apps/api/README.md` (a "Plan 3" section with the steps below). Nothing is run by the implementer: Julius applies the migration and deploys.

- [ ] **Step 1:** Root `npm test`, `npm run typecheck`, `KENNKO_API_URL= npm run build -w @kennko/web`, `npm run build -w @kennko/api` (load `server.js` with dummy env) on the branch tip.
- [ ] **Step 2: Write the checklist** into the README, in this order:
  1. **Migration** `0016_staff_pins_and_devices.sql` (Julius, from `apps/api`, dry run first; it must list only 0016). It is backward compatible for existing staff: the old API and website keep signing in, but the old website's Staff screen edits are refused until step 3.
  2. **API** deploy. No new environment variables. Smoke: `/health` 200; `POST /v1/devices/pair {"code":"000000"}` → 401 `PAIRING_FAILED`; `GET /v1/staff` without a token → 401; `GET /v1/devices/me` with `Bearer kd_x` → 401.
  3. **Website** deploy right after. Smoke: owner signs in; Staff lists everyone; **Set PIN** on the owner shows a PIN once; add a barista without email and give them a PIN; a manager login (if any) sees Orders but not Staff or Tills.
  4. **Till** (shop computer): pull, `npm run pos:build`, restart. It still asks the `config.json` PIN. Tablets type the PIN once and stay signed in across reloads and a till restart.
  5. **Pair:** admin › Tills › Add a till → code; on the till, Menu › Connect this till → code + manager PIN → "Connected as Counter till". Because the owner now has a PIN, the gate asks for personal PINs; the barista's PIN opens it; a void asks for the owner's PIN.
  6. **Revoke check (optional):** Disconnect in admin; within 5 minutes the till shows "Disconnected in admin" and still sells; pair again with a new code.
- [ ] **Step 3: Commit** `docs(api): plan 3 deploy checklist`

## Self-review notes

- Spec coverage for roadmap row 3: `manager` role ✔ (2, 3, 5, 6), `user_id` separate from `id` and the owner row kept working ✔ (2, 3, 6), `pin_hash`/`pin_updated_at` with scrypt + per-row salt ✔ (1, 2, 5), devices table ✔ (2), pairing code 6 digits / 10 minutes / 5 attempts / token stored as hash ✔ (3, 4), revoke stops the next request ✔ (3, 4), token limited to device routes ✔ (3), owner endpoints `POST /v1/devices`, `DELETE /v1/devices/:id`, `POST /v1/devices/pair`, staff and PIN management ✔ (4, 5), admin Staff and Devices screens ✔ (6, 7), till pairing screen, token stored locally, PIN typed once for a session cookie, offline PIN checks from active-staff hashes ✔ (8, 9), no device row for the wall ✔ (untouched). Deferred by design: `shifts`/`cash_moves`, attribution of till actions, sold-out PIN, sync and clock check (Plan 4, Rulings 1 and 12).
- Known limit: a 6-digit PIN hash on the till computer can be brute-forced offline by someone with the disk; the spec accepts this so PINs work offline. The token and `data/device.json` are the stronger secret and are revocable.
- Concurrency: PGlite shares one session, so the concurrent pairing and last-owner tests run sequentially; correctness rests on the single conditional `update … returning` (pairing) and `for update` on the owner rows (last owner).
