# Kennko API

Hono app on Vercel. It owns the published menu: `GET /v1/menu`, `GET /v1/menu/:version`, `POST /v1/menu/publish` (owner only), online checkout `POST /v1/orders` (multipart: `order` JSON + `proof` image), `GET /health`, and tills: `POST /v1/devices` (owner, returns a 6-digit pairing code), `GET /v1/devices`, `DELETE /v1/devices/:id` (revoke), `POST /v1/devices/pair` (no auth, code in, device token out) and `GET /v1/devices/me` (device token). Owner-only staff: `GET/POST /v1/staff`, `PATCH /v1/staff/:id` (name, role, active; there is always one active owner; reactivating clears the PIN) and `POST /v1/staff/:id/pin` (returns a fresh random 6-digit PIN once, never one another active person has). Migrations live in `supabase/migrations`.

Environment variables (see `src/config.ts`):

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Supabase **transaction pooler** URL, user `kennko_api.<project ref>`, port 6543 |
| `SUPABASE_URL` | `https://<project ref>.supabase.co` (used to verify owner tokens) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key. Used **only** by `src/storage.ts` to upload, remove and sign payment proofs in the private `payment-proofs` bucket. SQL never uses it. |

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
select classid::regclass, objid from pg_depend where refobjid = 'public.staff_role'::regtype;
```

Expect only rows that come from the `staff` table. If either result differs, stop and ask before applying.

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

### 3. Website deploy

Deploy right after the API. Smoke checks:

- The owner signs in.
- Staff lists everyone.
- **Set PIN** on the owner shows a PIN once.
- Add a barista without an email and give them a PIN.
- A manager login (if any) sees Orders but not Staff or Tills.

### 4. Till (shop computer)

Pull, run `npm run pos:build`, restart. The till still asks for the `config.json` PIN until the owner has a PIN.

- Reload every tablet after updating. Old tabs keep the old PIN flow until reloaded.
- A tablet types the PIN once and stays signed in across reloads and a till restart.
- A tablet that used both the https and the http address signs in once on each.

### 5. Pair the till

In admin, open Tills, then Add a till, and note the code. On the till, open Menu, then Connect this till, enter the code and the manager PIN. It should say "Connected as Counter till".

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
