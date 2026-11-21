# Kennko API

Hono app on Vercel. It owns the published menu: `GET /v1/menu`, `GET /v1/menu/:version`, `POST /v1/menu/publish` (owner only), online checkout `POST /v1/orders` (multipart: `order` JSON + `proof` image), `GET /health`, and tills: `POST /v1/devices` (owner, returns a 6-digit pairing code), `GET /v1/devices`, `DELETE /v1/devices/:id` (revoke), `POST /v1/devices/pair` (no auth, code in, device token out), `GET /v1/devices/me` (device token) and `POST /v1/sync/push` (device token; 1 to 50 till events, each answered `applied`, `flagged`, `held` or `duplicate`; held events are kept and retried by the API on that till's next push) and `GET /v1/sync/pull?version=N` (device token; the published menu if newer than N, sold-out ids, active staff PIN hashes, shop name/address/phone, and `onlineOrders`: paid online orders, unfinished first then those finished in the last 24 h by the API's clock, at most 200, read through the column lists in `src/sync/online-orders.ts`; no money, email, payment reference, proof, order code, staff note or map pin; the customer's phone and address only on delivery orders) and `POST /v1/sync/import` (device token; the till's pre-sync history in chunks of at most 100 rows: `{ shifts, orders, cashMoves }` in, `{ inserted, existing, rejected }` out; safe to send again; orders are stored as sent, flagged `legacy`, never re-priced; each row is checked alone, and a row the API cannot store is kept as a held `invalid: legacy: …` receipt in `sync_events` (kind `import.*`) and counted `rejected`, never dropped and never failing the chunk). Owner-only staff: `GET/POST /v1/staff`, `PATCH /v1/staff/:id` (name, role, active; there is always one active owner; reactivating clears the PIN) and `POST /v1/staff/:id/pin` (returns a fresh random 6-digit PIN once, never one another active person has). Migrations live in `supabase/migrations`.

Environment variables (see `src/config.ts`):

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Supabase **transaction pooler** URL, user `kennko_api.<project ref>`, port 6543 |
| `SUPABASE_URL` | `https://<project ref>.supabase.co` (used to verify owner tokens) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secret key (`sb_secret_…`). Used **only** by `src/storage.ts` (upload, remove and sign payment proofs in the private `payment-proofs` bucket) and `src/auth-admin.ts` (the staff invite). SQL never uses it, and the website never has it. |

No secret goes in the repo. Keep passwords and tokens in the Vercel dashboard and your shell only.

## Order matters (Plan 1)

Do the steps below in this order:

1. Database (apply 0012)
2. API on Vercel
3. Website deploy with `KENNKO_API_URL`
4. First Publish menu
5. One test checkout
6. Publish lock check
7. Till config
8. Later: 0013 (drop the old tables)

Hazards:

- Apply 0012 **before** deploying the website from this branch. The new admin and checkout need the new tables.
- Between applying 0012 and deploying the new website (step 3), do **not** edit the menu in admin. The old admin writes the old tables.
- Publish menu and the lock check need the **new** website, so they come after step 3.
- Apply 0013 only after the new website is live and one checkout has been tried.

## 1. Database

Run inside `apps/api`. Keep the existing migrations.

```sh
cd apps/api
npx supabase init            # creates supabase/config.toml; answer no to the IDE prompts
npx supabase login           # opens the browser
npx supabase link --project-ref <kennko ref>
```

`link` asks for the database password (Supabase dashboard, Project Settings, Database). Type it at the prompt. It never goes in a file or in chat.

Check what would be applied first:

```sh
npx supabase db push --dry-run
```

The first push applies 0012 only; 0013 waits for step 8. Stop if the list contains anything other than 0012 (0013 included: if it shows up, move `supabase/migrations/0013_drop_legacy_menu.sql` out of the folder until step 8, then put it back). If it lists 0001 to 0011, they were probably applied outside the CLI. Mark the ones already applied, then dry-run again:

```sh
npx supabase migration repair --status applied <version> [<version> ...]
```

When the dry run lists only 0012, apply it. (0012 is already applied in production as of 2026-11-20, so production skips this.)

```sh
npx supabase db push
```

0013 (`0013_drop_legacy_menu.sql`) now exists in the repo. Do not apply it yet; see step 8.

`supabase/.temp/` is git-ignored. Do not commit it.

## 2. API on Vercel

First give the API its database login. Migration 0012 creates the role `kennko_api` with `nologin`. Generate a password:

```sh
openssl rand -hex 24
```

In the Supabase SQL editor run:

```sql
alter role kennko_api with login password '<the generated password>';
```

Then delete the saved query from the SQL editor's history, so the password is not kept there.

Build `DATABASE_URL` from the dashboard's **transaction pooler** string (Connect, Transaction pooler). Change the user to `kennko_api.<project ref>` and the password to the one above. A hex password needs no URL-encoding.

Then in Vercel:

1. Create the project from the repo with **root directory `apps/api`**, on the Pro team. `npm run build` (set in `apps/api/vercel.json`) bundles `src/main.ts` and `@kennko/core` into `server.js`, which Vercel deploys; hono, postgres, jose, zod and web-push stay external (installed from `package.json`). Core ships TypeScript source, which Node will not run from `node_modules`, so the bundle is required.
2. Set the function region to the Supabase project's region (see the project's dashboard).
3. Set `DATABASE_URL` and `SUPABASE_URL` for Production (and Preview if you use it).
   For Web Push also set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:you@example.com`), all three or none. Generate the pair once with `npx web-push generate-vapid-keys`. Without them push is off: the API still boots, `GET /v1/push/public-key` answers 404 and `POST /v1/push/subscriptions` answers 503 `PUSH_UNAVAILABLE`. A partial set (one or two of the three) or values web-push rejects (a subject that is not a `mailto:`/`https:` URL, a wrong-length key) also turn push off with a warning in the logs instead of stopping the API.
4. Deploy, then check:

```sh
curl <api>/health        # {"ok":true}
```

## 3. Website deploy

1. Set `KENNKO_API_URL` to the API's URL on the website's Vercel project (`kennko`, team `illamapaloozas-projects`) and in `apps/web/.env.local`.
2. Deploy the website from this branch.

## 4. First Publish menu

1. Sign in to admin as the owner and press **Publish menu**.
2. Check the result lists the drinks and Food:

```sh
curl <api>/v1/menu
```

## 5. One test checkout

Place one order on the live site and confirm it goes through. Only after this is it safe to apply 0013 later.

## 6. Verify the publish lock

The test database (PGlite) cannot prove the publish lock, so check it against the real API.

First get the owner's access token. Do not paste it into shared places (chat, tickets, commits, synced shell history).

- Easiest: sign in to Supabase's auth API. Get the anon key from Dashboard, Project Settings, API. Type the email and password at the prompts:

```sh
read -r EMAIL; read -rs PW; read -r ANON
curl -s "<SUPABASE_URL>/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}"
```

  Copy `access_token` from the JSON reply.
- Or from the browser: sign in to admin, DevTools, Application, Local Storage or Cookies, the `sb-...-auth-token` entry, `access_token`.

Keep it in a shell variable only (`read -rs TOKEN`). Tokens expire after about an hour.

Then:

1. In admin, change one price (do not publish).
2. Start two publishes at the same moment:

```sh
curl -s -X POST <api>/v1/menu/publish -H "Authorization: Bearer $TOKEN" > a.json &
curl -s -X POST <api>/v1/menu/publish -H "Authorization: Bearer $TOKEN" > b.json &
wait; cat a.json b.json
```

3. Both replies must show the **same version**. One should show `"created":true` and the other `"created":false`. If both are `true`, or the versions differ, stop and fix before going further.
4. Delete `a.json` and `b.json`.

## 7. Till config

1. Set `"api": { "url": "<api url>" }` in the shop's `apps/pos/config.json` (or set `KENNKO_API_URL`). The till no longer reads `apps/web/.env.local`.
2. Restart the till. **Menu, Update from website** appears once `api.url` is set.
3. Run it with the manager PIN.

## 8. Later: 0013

0013 (`0013_drop_legacy_menu.sql`) now exists in the repo. Apply it only when all of these are true:

- The new website is live and a checkout has worked.
- The shop till is updated to this branch (step 7).
- This branch is merged.

Then dry-run, confirm the list is 0013 only, and push.

## Plan 3: staff PINs and tills

Deploy in this order. Migration 0016 adds the `manager` role, `staff.user_id`, per-person PINs and the `devices` table.

### 1. Migration 0016 (Julius)

0016 is backward compatible for existing staff: the old API and the old website keep signing in. The old website's Staff screen edits are refused until step 3.

First, in the Supabase SQL editor, run these two read-only checks:

```sql
select conname from pg_constraint where conrelid = 'public.staff'::regclass;
```

Expect `staff_id_fkey` among the rows.

```sql
select pg_describe_object(classid, objid, objsubid) from pg_depend where refobjid = 'public.staff_role'::regtype;
```

Expect exactly these three rows:

```
column role of table staff
default value for column role of table staff
type staff_role[]
```

Anything else (a function, view or policy) means stop. If either result differs, stop and ask before applying.

**Don't use the Staff screen between steps 1 and 3.** The old website's invite form would create staff rows whose
login can't sign in.

Then, from `apps/api`, dry run first. It must list only 0016:

```sh
npx supabase db push --dry-run
```

Apply 0016 as one whole file (do not split it or paste it in pieces):

```sh
npx supabase db push
```

### 2. API deploy

No new environment variables. Smoke checks:

- `GET /health` returns 200.
- `POST /v1/devices/pair` with `{"code":"000000"}` returns 401 `PAIRING_FAILED`.
- `GET /v1/staff` without a token returns 401.
- `GET /v1/devices/me` with `Authorization: Bearer kd_x` returns 401.

Optional hardening: add a Vercel Firewall rate limit on `POST /v1/devices/pair`. The endpoint is public, and five
wrong codes in a row burn the live codes, so someone guessing can make a real pairing fail.

### 3. Website deploy

Deploy right after the API. Smoke checks:

- The owner signs in.
- Staff lists everyone.
- **Set PIN** on the owner shows a PIN once.
- Add a barista without an email and give them a PIN.
- A manager login (if any) sees Orders but not Staff or Tills.

### 4. Till (shop computer)

The shop till is the Windows computer at the counter. Update it as in
[deploy/windows/README.md](../../deploy/windows/README.md) › Updating: first pull the new code (`setup.cmd` does not
pull),

```
cd $HOME\kennko
git pull
```

then double-click `deploy\windows\setup.cmd`. It rebuilds and restarts, keeping the PINs and the sales. The till
still asks for the `config.json` PIN until the owner has a PIN.

- Check that `api.url` is set in `apps\pos\config.json` (the API address from step 2). Without it the till cannot pair.
- Check that `managerPin` is not empty. An empty `managerPin` blocks voids, closing the till and pairing.

- Reload every tablet after updating. Old tabs keep the old PIN flow until reloaded.
- A tablet types the PIN once and stays signed in across reloads and a till restart.
- A tablet that used both the https and the http address signs in once on each.

### 5. Pair the till

Before pairing:

- In admin › Staff, issue a PIN to everyone who works the till.
- Make whoever closes the till a manager (or owner) with a PIN. Only they can void, cash out and close once pairing is done.
- Pair outside service hours. Pairing switches the till to personal PINs and signs every tablet out, and the
  `config.json` PINs stop working.

In admin, open Tills, then Add a till, and note the code. On the till, open Menu, then Connect this till, enter the code and the manager PIN. The This till card should say "Connected as <the name you gave it>".

Because the owner now has a PIN, the gate asks for personal PINs. The barista's PIN opens it. A void asks for the owner's PIN.

### 6. Revoke check (optional)

Disconnect the till in admin. Within 5 minutes the till shows "Disconnected in admin" and still sells. Pair it again with a new code.

### 7. Visual checks not yet done

These need the live API, so they were not done during the build. Check them after deploy:

- Website Staff and Tills screens at 375 px and 1024 px wide.
- Till Gate in per-person mode.
- Till "This till" card.
- Till Connect this till flow.
- The first name showing on the narrow rail.

## Plan 4: till sync

Plan 3 must be deployed first (tills paired, personal PINs working). Deploy in this order. Migration 0017 adds `shifts`, `cash_moves`, `sync_events`, the counter-order columns on `orders` and the till-sync checks. It is additive: the deployed API and website keep working until the new API is live.

### 1. Migration 0017 (Julius)

First, in the Supabase SQL editor, run this read-only pre-flight:

```sql
select count(*) from orders where channel = 'counter';
```

Expect `0`. Anything else means stop and ask: 0017's checks scan `orders` and would reject existing counter rows.

Apply 0017 as one whole file, **outside opening hours if possible** (its checks scan `orders` under a lock). From `apps/api`, dry run first. It must list only 0017:

```sh
npx supabase db push --dry-run
```

Then apply:

```sh
npx supabase db push
```

### 2. API deploy

No new environment variables. Smoke checks:

- `GET /health` returns 200.
- `POST /v1/sync/push` with `Authorization: Bearer kd_x` returns 401.
- `GET /v1/sync/pull` without a token returns 401.
- `GET /v1/devices/me` with a real till token still answers (it stays for tills not yet upgraded).

### 3. Concurrency and import check (once, before pairing the shop till)

The test database (PGlite) shares one backend session, so it cannot prove that two pushes from the same till at the same moment are safe. Check it against the real database through the pooler. This also runs the history import as `kennko_api` once before the shop till pairs.

1. In admin › Tills, add a throwaway till named exactly `sync test` and pair it with the code. Use a throwaway device, not the shop till. Every test row below is dated 1 January 2000 (a day the shop never traded, and the earliest the API accepts), and step 9 removes them all.
2. Make a new shift id with `uuidgen | tr A-Z a-z` and another for the event id. Save this as `push.json`, with the two ids in place of `<uuid>` (event id first, then the shift id):

```json
{"events":[{"id":"<uuid>","seq":1,"kind":"shift.opened","occurredAt":"2000-01-01T08:00:00+08:00","staffId":null,"payload":{"shiftId":"<uuid>","openingFloatCentavos":100000}}]}
```

3. With the throwaway device's token in `$TOKEN` (type it with `read -rs TOKEN`, never in a file), send it twice at the same moment:

```sh
curl -sS -w '\n%{http_code}\n' -X POST <api>/v1/sync/push -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data @push.json > a.json &
curl -sS -w '\n%{http_code}\n' -X POST <api>/v1/sync/push -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data @push.json > b.json &
wait; cat a.json b.json
```

4. Expect both to end in `200`, one reply with the event `applied` and the other with it `duplicate`. The second reply waits on the first one's lock, so it can take a moment longer. A `400` means the body is wrong: fix `push.json` and try again; it is not a pass. Two `applied`, or a `500`, means stop and do not pair the shop till.
5. Make the timing and import files (they reuse the shift id from `push.json`):

```sh
node -e '
const { randomUUID: u } = require("crypto"); const fs = require("fs");
const shiftId = JSON.parse(fs.readFileSync("push.json")).events[0].payload.shiftId;
const events = Array.from({ length: 50 }, (_, i) => ({ id: u(), seq: i + 2, kind: "cash.moved", occurredAt: "2000-01-01T08:05:00+08:00", staffId: null, payload: { shiftId, id: u(), kind: "in", amountCentavos: 100, reason: "Sync test" } }));
fs.writeFileSync("push50.json", JSON.stringify({ events }));
const shift = () => ({ id: u(), openedAt: "2000-01-01T08:00:00+08:00", openingFloatCentavos: 0, closedAt: "2000-01-01T09:00:00+08:00", countedCentavos: 0, expectedCentavos: 0, note: "sync test", openedByStaff: null, closedByStaff: null });
fs.writeFileSync("import1.json", JSON.stringify({ shifts: [shift()], orders: [], cashMoves: [] }));
fs.writeFileSync("import100.json", JSON.stringify({ shifts: Array.from({ length: 100 }, shift), orders: [], cashMoves: [] }));
'
```

6. One import chunk with one legacy shift. Expect `{"inserted":1,"existing":0,"rejected":0}` and `200`; send it again and expect `existing` 1. A `500` means stop: the import cannot run as `kennko_api`.

```sh
curl -sS -w '\n%{http_code}\n' -X POST <api>/v1/sync/import -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data @import1.json
```

7. Time one 50-event push and one 100-row import (the till's largest requests). Each should answer `200` well within the till's 15 s timeout; note the times.

```sh
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' -X POST <api>/v1/sync/push -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data @push50.json
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' -X POST <api>/v1/sync/import -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data @import100.json
```

8. Delete `a.json`, `b.json`, `push.json`, `push50.json`, `import1.json` and `import100.json`.
9. Remove the test rows right away, before anything else, so they never reach the day report or the stuck-shift query in the runbook below. Julius runs this in the Supabase SQL editor. Find the device id (expect exactly one row; if there are more, stop and ask):

```sql
select id from devices where name = 'sync test';
```

Check that nothing else points at its shifts (the check creates no orders, so expect `0`; anything else means stop and ask):

```sql
select count(*) from orders where shift_id in (select id from shifts where device_id = '<id>');
```

Then, in this order, with that id:

```sql
delete from cash_moves where shift_id in (select id from shifts where device_id = '<id>');
delete from shifts where device_id = '<id>';
delete from sync_events where device_id = '<id>';
```

Expect 50 cash moves, 102 shifts (the open one plus 101 legacy) and the device's receipts. Then, in admin › Tills, revoke the throwaway device.

### 4. Website

No change in this plan (admin already lists online orders only).

### 5. Till (shop computer)

- Close the till first if possible.
- Take a manual backup copy of `data/pos.db` (the whole `apps\pos\data` folder is safest).
- Update as in Plan 3 step 4 (`git pull`, then `deploy\windows\setup.cmd`, which runs `npm run pos:build` and restarts).
- The till's startup line is `Sync: paired, every 15 s, N old records to copy to Kennko` while the history import has rows left, and `Sync: paired, every 15 s` (no suffix) once it is done. While it runs, the Menu screen shows "Copying sales history to Kennko: N left." Pairing and Check now do not wait for it: pairing answers within about 5 s and Check now within about 10 s, and the import keeps going in the background.
- On a till that is not paired, a sold-out size or add-on that came from a manual menu pull (Menu › Update from website, with a manager PIN) stays off until the till is paired: the Menu screen switches whole drinks only.
- Reload every tablet after updating. Old tabs keep the old screens until reloaded.
- Check in Supabase (read-only): `select count(*) from orders where 'legacy' = any(flags);` equals the till's order count. Restart the till: it imports nothing new.
- Rows the API could not store (legacy or pushed) are kept as held receipts, not dropped. See them with:

```sql
select kind, reason, count(*) from sync_events where result = 'held' group by 1, 2;
```

  Since Plan 6, admin › Needs a look lists them (see the Plan 6 section below); the query stays as a cross-check.

### 6. Live checks

- Ring a ₱ test sale: within seconds an `orders` row appears with `channel 'counter'` and no flags.
- Void it with the owner's PIN: it becomes `cancelled` + `refunded`, and `cancelled_by_staff` is the owner.
- Mark a drink sold out on the till (it asks for a PIN): admin shows it sold out. Switch it back in admin: the till follows within 15 s.
- Pull the shop computer's network cable and ring two sales: the badge says "Offline: 2 sales waiting to send". Reconnect: the badge clears and both rows arrive once.

### 7. Menu

Publish a price change in admin. The till's Menu screen shows the new version within 15 s, without a PIN.

### 8. Visual checks not yet done

These need the live API, so they were not done during the build. Check them at 768 px and 1024 px wide:

- Till Gate in per-person mode.
- The sync pills and the offline badge.
- Menu › Check now (including "Still checking — the menu updates by itself.").
- The sold-out PIN prompt.

### Runbook: `pos.db` on a paired till, and a stuck open shift

**Never replace or restore `data/pos.db` on a paired till without closing its shift first** (Till › Close, so the close reaches Kennko). The server allows one open shift per till. A restored `pos.db` has forgotten the shift that is open on the server, so the next `shift.opened` from that till is held behind it and the till's new sales wait too (they stay safe on the till and send once the old shift is closed). The same applies to copying `pos.db` from another computer.

If it happens anyway (since Plan 6), in admin open **Needs a look**, find the shift under **Open shifts**, press **Close this shift**, enter the cash counted (0 if unknown) and a note saying why, then **Close shift** and confirm with **Yes, close it**. The till's held events retry on its next push (within 15 s); **Try again now** on the till's row retries them sooner. If the till's own close arrives later, it replaces the admin close.

Last resort only (admin not reachable): Julius runs this in the Supabase SQL editor.

Find the stuck shift (read-only):

```sql
select id, device_id, opened_at from shifts where closed_at is null;
```

Close it by hand, using the `id` from above. Put the counted cash if known (else `0`) and say why in the note:

```sql
update shifts
set closed_at = now(),
    counted_centavos = 0,
    expected_centavos = null,
    note = 'Closed by hand: pos.db was replaced on the till',
    updated_at = now()
where id = '<shift id>' and closed_at is null;
```

The till's held events retry on its next push (within 15 s) and apply once nothing blocks them. Check with:

```sql
select kind, reason, count(*) from sync_events where result = 'held' group by 1, 2;
```

## Plan 5: online orders in the till queue

Plans 3 and 4 must be deployed first (tills paired, sync working). Plan 5 puts paid online orders on the till's Orders board and on the wall, and lets the till step them forward. **There is no migration in this plan.** Deploy in this order, and update the till and the wall together: the wall must have this plan's change before online orders reach it, or an online order's number clashes with a counter order's number on the wall (online order 3 against counter order 3).

### 1. Migration

None. Run the dry run from `apps/api` and confirm it lists nothing new after 0017:

```sh
npx supabase db push --dry-run
```

If it lists anything, stop and ask.

### 2. API deploy

No new environment variables. An old till ignores the new `onlineOrders` key in the pull reply, and admin is unchanged. Smoke checks:

- `GET /health` returns 200.
- `GET /v1/sync/pull` without a token returns 401.

### 3. Website

No change.

### 4. Till (shop computer)

- Update as in Plan 3 step 4 (`git pull`, then `deploy\windows\setup.cmd`, which runs `npm run pos:build` and restarts).
- The startup log's Sync line gains `, N online order(s) in the queue` once an online order is waiting.
- Reload every tablet after the update. Old tabs keep the old Orders board until reloaded.
- Do not run the till with PIN mode off (`staffPin` `""`, see `apps/pos/README.md`, "PIN modes") while online orders are on: the live feed then needs no sign-in and carries delivery addresses and phones to anyone on the shop LAN.

### 5. Wall

Do this at the same time as step 4. On the wall computer, `git pull`, then stop and restart `npm run wall:pos` from the repo root (see `wall/README.md`, "Following the till"). Then reload the wall page (twice if needed: the first load may still come from the wall's saved offline copy). W numbers must read W3, not 5003.

### 6. Live checks

- Place a ₱ test online pickup order on the website. In admin, press **Confirm payment**. Within 15 s it appears on the till's Orders board as `W<n>` with an **Online** pill, and on the wall with the customer's first name.
- Tap **Start** on the till: the phone that placed the order gets "W<n> is being prepared", and admin shows Preparing after a refresh.
- In admin press **Mark ready for pickup**: the till follows within 15 s, and the till's button now reads **Picked up**.
- Pull the shop computer's network cable and tap **Picked up**: the ticket leaves the board and the badge shows "Offline: changes waiting to send". Reconnect: the badge clears, admin shows Completed, and the customer got exactly one "complete" notification.
- A delivery test order shows the address, barangay and phone on the ticket, and **Out for delivery** sends "W<n> is on its way"; then **Delivered** completes it.
- Press **Cancel order** in admin on an online order: it leaves the till and the wall within 15 s (at the till's next sync).
- In admin › Tills press **Disconnect** on the till: its online tickets disappear.

### 7. Visual checks not yet done

These need a live API and a running wall, so they were not done during the build.

- Till Orders board with online tickets (pickup and delivery) at 768 px and 1024 px wide, including a long delivery address.
- The wall running against the till (`npm run wall:pos`) with a counter order and an online order at once. W labels must show on the banner ("Order W3 for Ana is ready!"), the board, the queue chips, the rail tickets, the cat tags and the barista bubbles.

## Plan 6: reports, Needs a look, and the website without the service key

Plans 3, 4 and 5 must be deployed first. Plan 6 adds admin › Reports and admin › Needs a look, moves the website's remaining reads onto the API, and removes the Supabase service-role key from the website. Migration 0018 is additive (columns, a check value and indexes). Deploy in this order: the website needs the new API (with its key) first.

### 1. Migration 0018 (Julius)

First, in the Supabase SQL editor, run this read-only pre-flight:

```sql
select conname from pg_constraint where conrelid = 'sync_events'::regclass and contype = 'c';
```

Expect `sync_events_result_check` (and the kind check). If `sync_events_result_check` is missing, stop and ask.

Also see how much Needs a look will open with. Each row needs a click (Discard, Try again now or Mark seen), and each list shows at most 200:

```sql
select kind, reason, count(*) from sync_events where result = 'held' group by 1, 2;
select count(*) from orders where flags_seen_at is null and cardinality(array_remove(flags,'legacy')) > 0;
```

The second is the flagged orders (any flag other than `legacy`). If either is in the hundreds, plan time to work through it, or ask before deploying.

From `apps/api`, dry run first. It must list only 0018:

```sh
npx supabase db push --dry-run
```

Then apply it as one whole file:

```sh
npx supabase db push
```

### 2. API deploy

1. Generate the website key. Do not paste it in chat, tickets or commits:

```sh
openssl rand -hex 32
```

2. Add it as `KENNKO_WEB_KEY` to the API's Vercel project (Production). It must be at least 32 characters after trimming, or the API stops at boot. The API keeps `SUPABASE_SERVICE_ROLE_KEY` (storage and the staff invite).
3. Deploy. Smoke checks:
   - `GET /health` returns 200. If it doesn't, open the deployment's runtime logs in Vercel (a boot error names the missing or invalid variable) and fix that before going on.
   - `GET /v1/orders/by-code/KNK-XXXXXX` returns 404 JSON.
   - `GET /v1/staff/alert-emails` without the key header returns 401.
   - `GET /v1/reports/day/<today>` without a token returns 401.
4. The old website keeps working: it still has its own key.

### 3. Website deploy

1. Add the same `KENNKO_WEB_KEY` value to the website's Vercel project (`kennko`), Production. Deploy.
2. Only once that deploy works, delete `SUPABASE_SERVICE_ROLE_KEY` from the `kennko` project (Production, Preview and Development) and redeploy.
3. Check the fresh deployment's build log and runtime show no "Missing … SERVICE_ROLE_KEY" error.
4. Recommended: rotate the Supabase secret key, because the old one lived on the website. The project uses Supabase's new API keys (secret keys `sb_secret_…`, the website's `sb_publishable_…`), so each secret key is revoked on its own: revoking the old one does not touch the publishable key or anyone's sign-in.
   1. In Supabase › Project Settings › API Keys, create a new secret key.
   2. Set it as `SUPABASE_SERVICE_ROLE_KEY` on **kennko-api only** (the API project) and redeploy the API. `GET /health` returns 200.
   3. Verify before revoking: in admin › Orders, press **View receipt** on an order with a payment (storage) and the proof opens; in admin › Staff, send a test invite to a spare email (auth admin) and it arrives. Deactivate that test staff member afterwards.
   4. Only when both work, revoke the old secret key. If either fails, keep the old key, put it back on kennko-api, redeploy, and ask.
5. `apps/web/.env.local` keeps `SUPABASE_SERVICE_ROLE_KEY` for the local scripts only (`seed`, `seed-zones`, `create-owner`); update it there after rotating.

### 4. Till (shop computer)

As in Plan 3 step 4: `git pull`, then `deploy\windows\setup.cmd` (builds and restarts). Reload the tablets. The till's feed now carries the drink names for the wall.

### 5. Wall

`git pull`, then stop and restart `npm run wall:pos` from the repo root. Reload the wall page: its service worker cache moved to v3, so the first load may still come from the old copy (reload twice if needed). `wall/data/menu.json` appears after the first feed from the till.

### 6. Live checks

Website, against the live API:

- Place a ₱ test order. The order page (`/order/<code>`) and its receipt load.
- Signed in with Google, `/orders` lists the history.
- Admin › Orders: on an order with a payment, press **View receipt** to open the GCash proof image.
- Press **Confirm payment** on the test order: the customer gets the email receipt, and staff still get the new-order alert. On another test order press **Reject**: the customer gets the rejection email.
- At checkout, the staff alert email arrives (the list comes from the API).
- Admin › Staff › **Add someone**, role Manager, with an email, then **Send invite**: the invite arrives. Try an email that already has a login: the form shows "That email already has a website login. Use a different email, or ask them to sign in first."

Admin › Reports, for today:

- the counter total equals the till's day summary;
- online equals the verified online orders;
- each shift's counted cash matches the till's close;
- on the history days, the legacy line reads "Includes N orders imported from the till's history."

Admin › Needs a look (owner only):

- It lists the held rows the Plan 4 query showed (`select kind, reason, count(*) from sync_events where result = 'held' group by 1, 2;`).
- **Discard** one test row with a note: it moves to **Resolved** (Open and Resolved tabs). **Mark seen** is the same for flagged receipts and orders.
- A stuck open shift shows under Open shifts with **Close this shift** when it is blocking sync or its till is disconnected; other open shifts are listed without the button (see the Plan 4 runbook above).

Wall with the till:

- The wall shows the till's drink names. Rename a drink and publish: the wall follows.
- Restart the wall with the till off: it keeps the names (from `wall/data/menu.json`).

### 7. Visual checks not yet done

These need a live API, so they were not done during the build. Check them at 375 px and 1024 px wide:

- Admin › Reports (tables scroll inside their cards, not the page).
- Admin › Needs a look, including the close-shift confirm.

## Plan 7: customer accounts, the digital stamp card and points

Plans 3, 4, 5 and 6 must be deployed first. Plan 7 adds the Kennko card (sign-in by email link, a QR code and a typed code), stamps and the free drink at the till, points, and admin › Customers. Migration 0019 is additive, except that it replaces `owns_order`. Deploy in this order: migration → API → website → till. The till must not send the new event kinds before the API accepts them, and the website needs the new API first. No new environment variables.

### 1. Migration 0019 (Julius)

First, in the Supabase SQL editor, run this read-only pre-flight. 0019 drops `owns_order(uuid,text)`, so nothing else may depend on it:

```sql
select classid::regclass, objid, pg_describe_object(classid, objid, objsubid) from pg_depend where refobjid = 'public.owns_order(uuid,text)'::regprocedure;
```

Expect only the three order policies (on `orders`, `order_lines` and `order_line_options`). 0019 rebuilds them. If anything else is listed, stop and ask.

From `apps/api`, dry run first. It must list only 0019:

```sh
npx supabase db push --dry-run
```

0019 also creates these indexes (check them in the file the dry run names): `customers_display_name_idx`, `orders_customer_idx`, `stamp_cards_one_open`, `stamp_cards_claimed_order_idx`, `stamps_one_per_order`, `stamps_card_idx`, `stamps_customer_idx`, `points_once_per_order`, `points_ledger_customer_idx` and `sync_events_linked_recent`.

Then apply it as one whole file:

```sh
npx supabase db push
```

Afterwards, in the SQL editor:

```sql
select count(*) from customers;
select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'owns_order';
select has_function_privilege('anon', 'public.owns_order(uuid, text, timestamptz)', 'EXECUTE') as anon,
       has_function_privilege('authenticated', 'public.owns_order(uuid, text, timestamptz)', 'EXECUTE') as authenticated;
select indexname from pg_indexes where indexname in ('stamp_cards_claimed_order_idx', 'stamps_customer_idx', 'sync_events_linked_recent') order by indexname;
```

The count is 0. `owns_order` has one row: `order_user_id uuid, order_email text, order_created_at timestamp with time zone` (three arguments, no two-argument version). Both privileges are `true`: anon must be able to run `owns_order`, or a signed-out read of orders fails instead of returning no rows. The last query lists all three indexes.

### 2. Supabase Auth (dashboard)

1. Authentication › Providers › **Email** is on, with **Confirm email** on and the magic link (email sign-in link) enabled. Google stays as it is.
2. Authentication › URL Configuration › Redirect URLs: add `https://kennko.vercel.app/auth/callback` (or the production domain, if the site has moved to its own), and allow the query string, because the website sends `/auth/callback?next=…` (for example `https://kennko.vercel.app/auth/callback**`). If it is not on the list, the link lands on the site root and nobody is signed in.
3. Authentication › Email Templates › **Magic Link**: put it in Kennko's wording. Keep the `{{ .ConfirmationURL }}` link.
4. SMTP stays on the existing Resend sender. No new service.
5. Rate limits: raise the email limit from the default to about 30 per hour.

### 3. API deploy

Deploy the API. No new variables. Smoke checks:

- `GET /health` returns 200.
- `GET /v1/me` without a token returns 401.
- `GET /v1/customers/by-code/KC-AAA-AAA-AAA` without a device token returns 401.
- `GET /v1/stamps/to-check` without a token returns 401.

An old website and an old till keep working against the new API: the till ignores the new fields, and `GET /v1/me/orders` now matches a guest order to an account only for orders placed after the account was created.

### 4. Website deploy

Deploy the website (new dependency `qrcode`, installed by the build). The new API must already be live.

Before announcing cards, Julius reads and approves the privacy notice text on `/privacy` (it is a draft).

### 5. Till (shop computer)

1. `git pull`, then `deploy\windows\setup.cmd` (installs the new `jsqr` dependency, builds the till and restarts it).
2. Reload every tablet, so they run the new screens.
3. On each tablet, open the till once on the https address (`https://<till address>:4443`) and allow the camera when asked. Scanning only works there; typing the code always works.

### 6. Live checks

Use a throwaway email address and a test customer. Website, on a phone:

- Open `/account` and press **Email me a sign-in link**. The email arrives from the Resend sender in Kennko's wording, and the link signs you in.
- Press **Get my Kennko card** (13 or older, privacy notice ticked). The account page shows the stamp card, the typed code and the QR code.

At the till (tablet):

- In a sale, press **Add Kennko card** and scan the QR code over https. The card code and stamp count show (the till never shows the customer's name).
- Type the code with one character wrong: the till says "Check the code" straight away, without asking the website.
- Type a valid code that no one holds: the till says "No Kennko card has that code. Check it with the customer." (A typo is caught by the code's last symbol, so this needs a well-formed code that was never issued, for example one printed by `node -e "import('@kennko/core').then(c => console.log(c.formatPublicCode(c.makePublicCode(n => Math.floor(Math.random() * n)))))"` run in `apps/api`.)
- Charge a drink and press **Stamp card**. In admin › Customers, the customer shows 1 stamp and the points for the price.
- Wi-Fi off on the till: type the code (it will confirm when back online), charge, stamp. Wi-Fi on: the stamp arrives within a sync.
- Fill the test card with 8 stamped test sales. Do not void any of them until the free-drink checks below are done: a void takes its stamp off, and the card is no longer full. The 9th stamp starts a new card, and the full one waits for a free drink.
- Free drink: with a full card on the sale, press **Make one drink free**, enter a manager PIN (it needs the internet) and charge. The drink's base price is ₱0 and add-ons are charged. Try a second free drink on the same card: the Manager PIN prompt says "No free drink waiting on this card." Voiding the free-drink sale gives the free drink back to the card.
- Stranded claim: fill another card, claim its free drink, then let the sale fail or leave it (for example unplug the till's network cable right after entering the manager PIN, then cancel the sale). After 30 minutes look the card up again, or open it in admin › Customers: the card is full again and can be claimed.
- Now void a stamped test sale: the stamp and its points are reversed.

Admin:

- Admin › Customers › the test customer › **Switch to paper card**. Stamp another sale at the till: it shows under **Stamps to check** (on Customers and on Needs a look). Switch back with **Switch to digital card**, then apply the stamp.
- As owner, adjust points with a note (for example +50): the balance and the ledger change.
- Online order: place an order signed in as the customer. Admin confirms the payment, and the points are credited. The till's online ticket shows **Stamp at pickup**.

Account deletion: on a throwaway account's page open **Delete account**, type DELETE and confirm. Then, in the SQL editor:

```sql
select count(*) from orders where customer_user_id = '<id>' or customer_id = '<id>';
select count(*) from customers where id = '<id>';
```

Both are 0, and the user is gone from Supabase › Authentication › Users.

### 7. Visual checks not yet done

These need a live API, a real camera and an email link, so they were not done during the build:

- `/account` (signed out, joining, with a card, with a full card) and admin › Customers (the list and one customer, including Stamps to check) at 375 px, 768 px and 1440 px wide.
- The till at 768 px and 1024 px wide: Add Kennko card (camera and typed), the customer chip, Make one drink free, Stamp card on the paid screen, History, and the Orders board with Stamp at pickup.
- The QR code scans from a phone screen in the shop's light.
