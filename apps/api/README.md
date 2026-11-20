# Kennko API

Hono app on Vercel. It owns the published menu: `GET /v1/menu`, `GET /v1/menu/:version`, `POST /v1/menu/publish` (owner only), online checkout `POST /v1/orders` (multipart: `order` JSON + `proof` image), and `GET /health`. Migrations live in `supabase/migrations`.

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

1. Create the project from the repo with **root directory `apps/api`**, on the Pro team. `npm run build` (set in `apps/api/vercel.json`) bundles `src/main.ts` and `@kennko/core` into `server.js`, which Vercel deploys; hono, postgres, jose and zod stay external. Core ships TypeScript source, which Node will not run from `node_modules`, so the bundle is required.
2. Set the function region to the Supabase project's region (see the project's dashboard).
3. Set `DATABASE_URL` and `SUPABASE_URL` for Production (and Preview if you use it).
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
