# Moving Kennko to a new Supabase project

Use this to start over on a fresh Supabase project, for example to change region (a project's region can't be changed)
or to wipe all test data before real ordering. Nothing is copied from the old project: every table, role, policy and
storage bucket comes from the migrations; the menu, delivery zones and owner come from the seed scripts; the cosmetics
catalogue comes from migration 0020.

What does **not** come back: customers, orders, stamps, points, cats, staff other than the owner, till pairings, push
subscriptions, uploaded product photos and payment proofs. That is the point of a fresh start.

Commands run from the repo root unless a step says otherwise. Never paste keys into chat or commit them.

## 1. Create the project

1. In the Supabase dashboard, create a new project. Pick the region closest to the shop: **Southeast Asia
   (Singapore), `ap-southeast-1`** for Butuan.
2. Save the database password the dashboard generates (you need it only for the CLI link).
3. Note the **project ref** (the `xxxx` in `https://xxxx.supabase.co`).

## 2. Apply the migrations (Julius)

From `apps/api`, point the CLI at the new project, then apply all migrations (0001 to 0020):

```sh
cd apps/api
npx supabase link --project-ref <new project ref>
npx supabase db push --dry-run
npx supabase db push
```

The dry run must list every migration, `0001_menu_schema.sql` to `0020_cats_and_visits.sql`.

## 3. Give the API its database login

Migration 0012 creates the role `kennko_api` without a login. Make a password:

```sh
openssl rand -hex 24
```

In the new project's SQL editor:

```sql
alter role kennko_api with login password '<the generated password>';
```

Delete that query from the SQL editor's history afterwards.

Build `DATABASE_URL` from **Connect › Transaction pooler**: change the user to `kennko_api.<project ref>` and the
password to the one above.

## 4. Sign-in settings (dashboard)

Authentication › URL Configuration:

- **Site URL:** `https://kennko.vercel.app`
- **Redirect URLs:** `https://kennko.vercel.app/auth/callback`, plus `http://localhost:3123/auth/callback` and
  `http://localhost:3000/auth/callback` for local testing.

Authentication › Providers:

- **Email:** on, with **Confirm email** on and the email sign-in link enabled. Owner and managers sign in to
  `/admin/login` with email and password; customers get the link.
- **Google:** on, with the same client ID and secret as the old project. In Google Cloud Console › Credentials,
  add the new callback `https://<new project ref>.supabase.co/auth/v1/callback` to the OAuth client's authorised
  redirect URIs. Without it, Google sign-in fails.

If the old project had custom SMTP or email templates, copy them across too.

## 5. Keys

From the new project's **Settings › API Keys** take the **publishable** key (`sb_publishable_…`) and a **secret** key
(`sb_secret_…`).

**Vercel, `kennko-api`** (Production): replace `DATABASE_URL` (step 3), `SUPABASE_URL`
(`https://<new project ref>.supabase.co`) and `SUPABASE_SERVICE_ROLE_KEY` (the secret key). Keep `KENNKO_WEB_KEY` and
the `VAPID_*` keys as they are. Set the function region to match the database: **Settings › Functions › Region:
Singapore (`sin1`)** for `ap-southeast-1`.

**Vercel, `kennko`** (the website, Production): replace `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (the publishable key). The website must **not** have `SUPABASE_SERVICE_ROLE_KEY`;
remove it if it is still there.

**Your Mac, `apps/web/.env.local`:** the same `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, plus
`SUPABASE_SERVICE_ROLE_KEY` (the secret key), which only the seed scripts below use.

Then redeploy both projects so they pick up the new values.

## 6. Seed the menu, delivery zones and the owner

First make sure `apps/web/.env.local` points at the **new** project (step 5): the scripts read it, and they would
otherwise seed the old one. Then from `apps/web`:

```sh
cd apps/web
npm run seed:all
npm run create-owner -- <owner email> '<password, 12+ characters>' "<Full Name>"
```

- `seed:all` loads the 15 delivery zones and the drinks menu (categories, items, sizes and prices, add-ons). It
  is safe to run again: it updates rows by name instead of duplicating them.
- `create-owner` makes the owner's login (email and password, already confirmed) and the owner staff row. Use it
  once per project.

## 7. Publish the menu (owner)

Sign in at `https://kennko.vercel.app/admin/login` with the owner email and password, open **Menu** and press
**Publish**. Until the first publish, the website's menu and the till's "Update from website" have nothing to read.
Upload product photos again in admin if you want them.

## 8. Check

```sh
curl https://kennko-api.vercel.app/health          # {"ok":true}
curl https://kennko-api.vercel.app/v1/cosmetics    # 22 items
curl https://kennko-api.vercel.app/v1/menu         # the published menu
```

Then sign in on the website as a customer (Google or the email link), get a Kennko card, and dress a cat.

## 9. Tills

Pairings from the old project don't carry over. On each till: **Menu › This till**, forget the old connection
(or `POST /api/device/forget` with a manager PIN), then add the till again in **admin › Tills** and connect it with
the new code. Issue staff PINs again in **admin › Staff**.

When everything works, pause or delete the old Supabase project.
