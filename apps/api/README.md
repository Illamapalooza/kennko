# Kennko API

Hono app on Vercel. It owns the published menu: `GET /v1/menu`, `GET /v1/menu/:version`, `POST /v1/menu/publish` (owner only), and `GET /health`. Migrations live in `supabase/migrations`.

Environment variables (see `src/config.ts`):

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Supabase **transaction pooler** URL, user `kennko_api.<project ref>`, port 6543 |
| `SUPABASE_URL` | `https://<project ref>.supabase.co` (used to verify owner tokens) |

No secret goes in the repo. Keep passwords and tokens in the Vercel dashboard and your shell only.

## Order matters (Plan 1)

1. Apply 0012 **before** deploying the website from this branch. The new admin and checkout need the new tables.
2. Between applying 0012 and deploying the new website, do **not** edit the menu in admin. The old admin writes the old tables.
3. Apply 0013 (drop the old tables) only after the new website is live and one checkout has been tried.

## 1. Database

Run inside `apps/api`. Keep the existing migrations.

```sh
cd apps/api
npx supabase init            # creates supabase/config.toml; answer no to the IDE prompts
npx supabase link --project-ref <kennko ref>
npx supabase db push         # applies 0012
```

Do not commit `supabase/.temp/`.

## 2. API login

Migration 0012 creates the role `kennko_api` with `nologin`. In the Supabase SQL editor run:

```sql
alter role kennko_api with login password '<generated, 32+ chars>';
```

Build `DATABASE_URL` from the dashboard's **transaction pooler** string (Connect, Transaction pooler). Change the user to `kennko_api.<project ref>` and the password to the one above. URL-encode any special characters in the password (or generate letters and digits only).

## 3. Vercel

1. Create the project from the repo with **root directory `apps/api`**, on the Pro team. Zero config: `src/index.ts` default-exports the app.
2. Set the function region to the Supabase project's region (see the project's dashboard).
3. Set `DATABASE_URL` and `SUPABASE_URL` for Production (and Preview if you use it).
4. Deploy, then check:

```sh
curl <api>/health        # {"ok":true}
```

## 4. First snapshot

1. Sign in to admin as the owner and press **Publish menu**.
2. Check the result lists the drinks and Food:

```sh
curl <api>/v1/menu
```

## 5. Owner token for curl checks

`POST /v1/menu/publish` needs the owner's access token. Do not paste it into shared places (chat, tickets, commits, synced shell history).

- Browser: sign in to admin, open DevTools, Application, Cookies or Local Storage for the site, and copy the `access_token` value from the `sb-...-auth-token` entry.
- Or Supabase's auth API (type the email and password at the prompts, not in the command):

```sh
read -r EMAIL; read -rs PW
curl -s "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: <anon key>" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}"
```

Keep the token in a shell variable only (`read -rs TOKEN`) and use `-H "Authorization: Bearer $TOKEN"`. Tokens expire after about an hour.

## 6. Verify the publish lock

The test database (PGlite) cannot prove the publish lock, so check it against the real API.

1. In admin, change one price (do not publish).
2. Start two publishes at the same moment:

```sh
curl -s -X POST <api>/v1/menu/publish -H "Authorization: Bearer $TOKEN" &
curl -s -X POST <api>/v1/menu/publish -H "Authorization: Bearer $TOKEN" &
wait
```

3. Confirm both responses carry the **same version** and exactly one has `"created": true`. If both are `true`, or the versions differ, stop and fix before going further.

## 7. Apps

1. Set `KENNKO_API_URL` on the website's Vercel project and in `apps/web/.env.local`, then deploy the website.
2. Try one checkout on the live site.
3. On the till, set `"api": { "url": "<api url>" }` in the shop's `apps/pos/config.json` (or set `KENNKO_API_URL`). The till no longer reads `apps/web/.env.local`. Without this, Menu, Update does not appear. Restart the till.
4. On the till, run **Menu, Update** with the manager PIN.
5. After the checkout works, apply 0013.
