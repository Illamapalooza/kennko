# Kennko Admin (Plan 2 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Kenn a role-gated admin at `/admin` where the owner manages the menu — items, per-size prices, categories, product photos, staff — and baristas toggle availability, without a developer or a redeploy.

**Architecture:** Supabase Auth (email + password, no public signup) backs a `staff` table carrying an `owner`/`barista` role. Authorisation is enforced twice: the UI hides what a role cannot do, and Postgres RLS plus a column-guard trigger reject the write regardless of what the client sends. Product photos live in a public-read, owner-write Supabase Storage bucket. Server actions perform all mutations.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (Postgres + RLS + Auth + Storage), Vitest, Vercel.

**Spec:** `docs/superpowers/specs/2026-08-24-kennko-ordering-design.md`

**Predecessor:** `docs/superpowers/plans/2026-08-24-kennko-foundation.md` (complete). This plan assumes its schema, `formatPesos()`, `getEnv()`, `getPublicClient()`, and `lib/menu/types.ts` already exist.

## Global Constraints

- **Money is integer centavos.** ₱105 is `10500`. Format only at render via `formatPesos()`.
- **`type`, never `interface`.**
- **Electric blue brand.** Admin reuses the tokens in `app/globals.css`: `--blue: #0055ff`, `--blue-dark: #003fc0`, `--amber: #ffb830`, `--text: #0d1b3d`, `--muted: #e8efff`.
- **Next 16: the file is `proxy.ts`, not `middleware.ts`,** and it exports `proxy`, not `middleware`. `middleware.ts` is deprecated. Next's own docs say to avoid relying on it "unless no other options exist", so it does token refresh only — never authorisation.
- **Authorisation is enforced in Postgres, not just the UI.** Any task that adds a capability adds the matching RLS policy and a test proving the wrong role is rejected at the database.
- **Phone, tablet, and desktop are all required.** Baristas verify and toggle on a phone behind the counter. Breakpoints 920px and 640px; verify at 375, 768, 1024, 1440px. Tap targets ≥ 44px.
- **The service-role key never reaches the browser.** It is used only in server-only modules and the seeder.
- **No ordering, cart, checkout, GCash, or email in this plan.** Those are Plan 3.
- **Supabase project ref is `lgyfijnfbccifozpnbij`.** Never touch another project.

---

## File Structure

| Path | Responsibility |
|---|---|
| `supabase/migrations/0002_staff_and_roles.sql` | `staff` table, role enum, `is_owner()` / `is_active_staff()` helpers, staff RLS |
| `supabase/migrations/0003_menu_write_policies.sql` | `is_archived`, menu write policies, barista column-guard trigger |
| `supabase/migrations/0004_menu_images_bucket.sql` | `menu-images` bucket and its storage policies |
| `scripts/create-owner.ts` | One-off bootstrap for the first owner account |
| `proxy.ts` | Supabase session cookie refresh only |
| `lib/supabase/admin.ts` | Server-only service-role client |
| `lib/auth/types.ts` | `StaffMember`, `StaffRole` |
| `lib/auth/session.ts` | `getCurrentStaff()`, `requireStaff()`, `requireOwner()` |
| `lib/images/validate.ts` | Magic-byte image validation |
| `app/admin/layout.tsx` | Auth guard + admin shell |
| `app/admin/admin.css` | Admin-only styles |
| `app/admin/login/page.tsx` | Sign-in form |
| `app/admin/login/actions.ts` | `signIn`, `signOut` |
| `app/admin/menu/page.tsx` | Menu list, availability toggle |
| `app/admin/menu/actions.ts` | Menu + category + image server actions |
| `app/admin/menu/[id]/page.tsx` | Item editor (owner) |
| `app/admin/staff/page.tsx` | Staff list (owner) |
| `app/admin/staff/actions.ts` | Invite, role change, deactivate |
| `components/admin/StaffRow.tsx` | Staff row/card with role and active controls |
| `components/admin/*` | Remaining admin UI components |

---

### Task 1: Staff table, roles, and RLS helpers

**Files:**
- Create: `supabase/migrations/0002_staff_and_roles.sql`, `scripts/create-owner.ts`, `lib/supabase/admin.ts`, `lib/auth/types.ts`

**Interfaces:**
- Consumes: `getEnv()` from Plan 1.
- Produces: SQL functions `public.is_owner()` and `public.is_active_staff()`, used by every later policy. Types `StaffRole = 'owner' | 'barista'` and `StaffMember`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0002_staff_and_roles.sql`:

```sql
create type staff_role as enum ('owner', 'barista');

create table staff (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null unique,
  full_name  text not null,
  role       staff_role not null default 'barista',
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

alter table staff enable row level security;

-- SECURITY DEFINER so these can read `staff` without tripping its own RLS,
-- which would otherwise recurse. search_path is pinned so a caller cannot
-- shadow `staff` with a table of their own and vote themselves owner.
create or replace function public.is_active_staff()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.staff
    where id = auth.uid() and is_active
  );
$$;

create or replace function public.is_owner()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.staff
    where id = auth.uid() and is_active and role = 'owner'
  );
$$;

-- A staff member sees their own row; an owner sees everyone.
create policy "staff read own row or owner reads all"
  on staff for select using (id = auth.uid() or public.is_owner());

create policy "owner inserts staff"
  on staff for insert with check (public.is_owner());

create policy "owner updates staff"
  on staff for update using (public.is_owner());

-- No delete policy: staff are deactivated, never deleted, so that
-- `orders.verified_by` in Plan 3 keeps pointing at a real person.
```

- [ ] **Step 2: Apply it**

```bash
export SUPABASE_ACCESS_TOKEN=<sbp_ token>
REF=lgyfijnfbccifozpnbij
python3 -c "import io,json;print(json.dumps({'query':io.open('supabase/migrations/0002_staff_and_roles.sql').read()}))" > /tmp/m2.json
curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" --data-binary @/tmp/m2.json
```

Expected: `[]`.

- [ ] **Step 3: Add the server-only service-role client**

Create `lib/supabase/admin.ts`:

```ts
import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * Service-role client. Bypasses RLS entirely, so every caller MUST establish
 * the caller's role first via requireOwner()/requireStaff(). The `server-only`
 * import makes bundling this into a client component a build error rather than
 * a silent key leak.
 */
export function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
```

Install the guard package: `npm install server-only`.

- [ ] **Step 4: Define the auth types**

Create `lib/auth/types.ts`:

```ts
export type StaffRole = 'owner' | 'barista'

export type StaffMember = {
  id: string
  email: string
  fullName: string
  role: StaffRole
  isActive: boolean
}
```

- [ ] **Step 5: Write the bootstrap script**

No staff row exists yet, so nobody can log in to invite anybody — a chicken-and-egg the admin UI cannot solve. Create `scripts/create-owner.ts`:

```ts
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const email = process.argv[2]
const password = process.argv[3]
const fullName = process.argv[4]

if (!url || !serviceKey) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
if (!email || !password || !fullName) {
  throw new Error('Usage: npm run create-owner -- <email> <password> "<Full Name>"')
}
if (password.length < 12) {
  throw new Error('Choose a password of at least 12 characters')
}

const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  const { data: created, error: authError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (authError) throw authError

  const { error: staffError } = await db.from('staff').insert({
    id: created.user.id,
    email,
    full_name: fullName,
    role: 'owner',
    is_active: true,
  })
  if (staffError) throw staffError

  console.log(`Created owner ${email} (${created.user.id})`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

Add to `package.json` scripts: `"create-owner": "tsx scripts/create-owner.ts"`.

- [ ] **Step 6: Create the owner account**

```bash
set -a; . ./.env.local; set +a
npm run create-owner -- kenn@example.com '<a-long-password>' "Kenn Baliling"
```

Expected: `Created owner ...`. Replace the email with Kenn's real address before running.

- [ ] **Step 7: Verify the helpers behave**

```bash
REF=lgyfijnfbccifozpnbij
curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select count(*) staff_rows, (select count(*) from staff where role='"'"'owner'"'"') owners from staff"}'
```

Expected: `staff_rows=1, owners=1`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add staff table, roles, and RLS helper functions"
```

---

### Task 2: Session refresh and auth helpers

**Files:**
- Create: `proxy.ts`, `lib/auth/session.ts`
- Test: `lib/auth/session.test.ts`

**Interfaces:**
- Consumes: `getServerClient()` from Plan 1, `StaffMember` from Task 1.
- Produces: `getCurrentStaff()`, `requireStaff()`, `requireOwner()`, and `mapStaffRow()`. Every admin page and server action uses these.

- [ ] **Step 1: Create the proxy**

`proxy.ts` at the project root — **not** `middleware.ts`, which Next 16 deprecated. It refreshes the Supabase session cookie and does nothing else; authorisation lives in the layout and in RLS.

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return response

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        items.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  // Touching the user refreshes an expired token and writes the new cookie.
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: ['/admin/:path*'],
}
```

The matcher is scoped to `/admin`, so the cached public marketing page never runs the proxy and stays statically served.

- [ ] **Step 2: Write the failing test for the staff row mapper**

Create `lib/auth/session.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mapStaffRow } from './session'

describe('mapStaffRow', () => {
  it('maps a snake_case row to a StaffMember', () => {
    expect(
      mapStaffRow({
        id: 'u-1',
        email: 'kenn@example.com',
        full_name: 'Kenn Baliling',
        role: 'owner',
        is_active: true,
      }),
    ).toEqual({
      id: 'u-1',
      email: 'kenn@example.com',
      fullName: 'Kenn Baliling',
      role: 'owner',
      isActive: true,
    })
  })

  it('returns null for a missing row', () => {
    expect(mapStaffRow(null)).toBeNull()
  })

  it('returns null for a deactivated staff member', () => {
    expect(
      mapStaffRow({
        id: 'u-2',
        email: 'ex@example.com',
        full_name: 'Former Barista',
        role: 'barista',
        is_active: false,
      }),
    ).toBeNull()
  })
})
```

The third case matters: a deactivated account must be indistinguishable from no account at all, or a fired barista keeps their session until it expires.

- [ ] **Step 3: Run it and confirm it fails**

Run: `npm test lib/auth/session.test.ts`
Expected: FAIL — `mapStaffRow` is not exported.

- [ ] **Step 4: Implement the session helpers**

Create `lib/auth/session.ts`:

```ts
import { redirect } from 'next/navigation'
import { getServerClient } from '@/lib/supabase/server'
import type { StaffMember, StaffRole } from './types'

type StaffRow = {
  id: string
  email: string
  full_name: string
  role: StaffRole
  is_active: boolean
}

export function mapStaffRow(row: StaffRow | null): StaffMember | null {
  if (!row || !row.is_active) return null
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active,
  }
}

export async function getCurrentStaff(): Promise<StaffMember | null> {
  const db = await getServerClient()

  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) return null

  const { data } = await db
    .from('staff')
    .select('id, email, full_name, role, is_active')
    .eq('id', user.id)
    .maybeSingle()

  return mapStaffRow(data as StaffRow | null)
}

export async function requireStaff(): Promise<StaffMember> {
  const staff = await getCurrentStaff()
  if (!staff) redirect('/admin/login')
  return staff
}

export async function requireOwner(): Promise<StaffMember> {
  const staff = await requireStaff()
  if (staff.role !== 'owner') redirect('/admin/menu?denied=owner-only')
  return staff
}
```

- [ ] **Step 5: Run tests and confirm they pass**

Run: `npm test lib/auth/session.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Confirm the public page is still static**

Run: `npm run build`
Expected: `/` still listed as `○ (Static)` with a `1m` revalidate. If it flipped to `ƒ (Dynamic)`, the proxy matcher is too broad — it must not cover `/`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add session refresh proxy and staff auth helpers"
```

---

### Task 3: Login page and sign-out

**Files:**
- Create: `app/admin/login/page.tsx`, `app/admin/login/actions.ts`, `app/admin/admin.css`
- Test: `app/admin/login/actions.test.ts`

**Interfaces:**
- Consumes: `getServerClient()`.
- Produces: `signIn(prevState, formData)` and `signOut()` server actions, and `validateCredentials()`. Task 4's shell renders the sign-out button.

- [ ] **Step 1: Write the failing test for credential validation**

Create `app/admin/login/actions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { validateCredentials } from './actions'

describe('validateCredentials', () => {
  it('accepts a well-formed email and password', () => {
    expect(validateCredentials('kenn@example.com', 'a-long-password')).toBeNull()
  })

  it('rejects a missing email', () => {
    expect(validateCredentials('', 'a-long-password')).toBe('Enter your email address.')
  })

  it('rejects a malformed email', () => {
    expect(validateCredentials('not-an-email', 'a-long-password')).toBe(
      'Enter a valid email address.',
    )
  })

  it('rejects a missing password', () => {
    expect(validateCredentials('kenn@example.com', '')).toBe('Enter your password.')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test app/admin/login/actions.test.ts`
Expected: FAIL — `validateCredentials` is not exported.

- [ ] **Step 3: Implement the actions**

Create `app/admin/login/actions.ts`:

```ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getServerClient } from '@/lib/supabase/server'

export type LoginState = { error: string | null }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateCredentials(email: string, password: string): string | null {
  if (!email) return 'Enter your email address.'
  if (!EMAIL_PATTERN.test(email)) return 'Enter a valid email address.'
  if (!password) return 'Enter your password.'
  return null
}

export async function signIn(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  const invalid = validateCredentials(email, password)
  if (invalid) return { error: invalid }

  const db = await getServerClient()
  const { error } = await db.auth.signInWithPassword({ email, password })

  // Deliberately vague: a distinct "no such account" message would let anyone
  // enumerate which addresses are staff.
  if (error) return { error: 'Those details did not match. Try again.' }

  redirect('/admin/menu')
}

export async function signOut() {
  const db = await getServerClient()
  await db.auth.signOut()
  revalidatePath('/admin', 'layout')
  redirect('/admin/login')
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npm test app/admin/login/actions.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Build the login page**

Create `app/admin/login/page.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { signIn, type LoginState } from './actions'

const initialState: LoginState = { error: null }

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, initialState)

  return (
    <main className="admin-auth">
      <form className="admin-auth-card" action={formAction}>
        <h1>Kennko Admin</h1>
        <p className="admin-auth-sub">Sign in to manage orders and the menu.</p>

        <label className="admin-field">
          <span>Email</span>
          <input name="email" type="email" autoComplete="username" required />
        </label>

        <label className="admin-field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>

        {state.error ? (
          <p className="admin-error" role="alert">
            {state.error}
          </p>
        ) : null}

        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
```

- [ ] **Step 6: Add the admin stylesheet**

Create `app/admin/admin.css`. Mobile-first; the two media queries match the public site's breakpoints.

```css
.admin-shell {
  min-height: 100vh;
  background: var(--muted);
  color: var(--text);
}

.admin-topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  background: var(--blue);
  color: var(--white);
}

.admin-topbar a,
.admin-topbar button {
  color: var(--white);
  font-weight: 700;
}

.admin-nav {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.admin-main { padding: 16px; }

.admin-auth {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: var(--blue);
  padding: 16px;
}

.admin-auth-card {
  width: 100%;
  max-width: 380px;
  background: var(--white);
  border-radius: var(--radius-lg);
  padding: 28px;
  display: grid;
  gap: 14px;
}

.admin-auth-sub { color: #4a5568; margin: 0; }

.admin-field { display: grid; gap: 6px; font-weight: 700; }

.admin-field input,
.admin-field select,
.admin-field textarea {
  min-height: 44px;
  padding: 10px 12px;
  border: 2px solid rgba(0, 85, 255, 0.2);
  border-radius: var(--radius-md);
  font: inherit;
  width: 100%;
}

.admin-error {
  color: #b3261e;
  background: #fdecea;
  border-radius: var(--radius-md);
  padding: 10px 12px;
  margin: 0;
}

.admin-notice {
  color: #7a4b00;
  background: #fff4e0;
  border-radius: var(--radius-md);
  padding: 10px 12px;
  margin: 0 0 14px;
}

/* Every interactive control clears the 44px minimum tap target. */
.admin-shell button,
.admin-shell .btn {
  min-height: 44px;
}

/* Phone: cards, never tables. */
.admin-table { display: none; }
.admin-cards { display: grid; gap: 12px; }

@media (min-width: 641px) {
  .admin-main { padding: 24px; }
}

@media (min-width: 921px) {
  .admin-table { display: table; width: 100%; border-collapse: collapse; }
  .admin-cards { display: none; }
  .admin-table th,
  .admin-table td {
    text-align: left;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(0, 85, 255, 0.14);
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add admin login, sign-out, and admin stylesheet"
```

---

### Task 4: Admin shell with auth guard and role-aware nav

**Files:**
- Create: `app/admin/layout.tsx`, `components/admin/SignOutButton.tsx`, `app/admin/page.tsx`

**Interfaces:**
- Consumes: `getCurrentStaff()` from Task 2, `signOut` from Task 3.
- Produces: the `/admin` shell. Every later admin page renders inside it and can assume a signed-in staff member.

Authorisation lives here rather than in the proxy, per Next 16's guidance to avoid relying on proxy for application logic.

- [ ] **Step 1: Build the layout**

Create `app/admin/layout.tsx`:

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getCurrentStaff } from '@/lib/auth/session'
import { SignOutButton } from '@/components/admin/SignOutButton'
import '../globals.css'
import './admin.css'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // The login page renders inside this layout but must not require a session.
  const pathname = (await headers()).get('x-pathname') ?? ''
  const staff = await getCurrentStaff()

  if (!staff) {
    if (pathname.startsWith('/admin/login')) return <>{children}</>
    redirect('/admin/login')
  }

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <strong>Kennko Admin</strong>
        <nav className="admin-nav">
          <Link href="/admin/menu">Menu</Link>
          {staff.role === 'owner' ? <Link href="/admin/staff">Staff</Link> : null}
        </nav>
        <span>
          {staff.fullName} · {staff.role}
        </span>
        <SignOutButton />
      </header>
      <main className="admin-main">{children}</main>
    </div>
  )
}
```

- [ ] **Step 2: Expose the pathname to the layout**

A layout cannot read the current path directly, so the proxy supplies it. Add to `proxy.ts`, replacing the `NextResponse.next({ request })` line:

```ts
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', request.nextUrl.pathname)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
```

- [ ] **Step 3: Create the sign-out button**

Create `components/admin/SignOutButton.tsx`:

```tsx
'use client'

import { signOut } from '@/app/admin/login/actions'

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button className="btn btn-secondary" type="submit">
        Sign out
      </button>
    </form>
  )
}
```

- [ ] **Step 4: Redirect the admin index to the menu**

Create `app/admin/page.tsx`:

```tsx
import { redirect } from 'next/navigation'

export default function AdminIndex() {
  redirect('/admin/menu')
}
```

- [ ] **Step 5: Verify the guard by hand**

Run `npm run dev`, then:

1. Visit `/admin/menu` signed out → redirected to `/admin/login`.
2. Sign in with the owner account → lands on `/admin/menu`, topbar shows "Kenn Baliling · owner" and a Staff link.
3. Sign out → back to `/admin/login`; revisiting `/admin/menu` redirects again.

`/admin/menu` will 404 until Task 6. Confirm the redirect happens before the 404 — that is the guard working.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add admin shell with auth guard and role-aware nav"
```

---

### Task 5: Menu write policies and the barista column guard

**Files:**
- Create: `supabase/migrations/0003_menu_write_policies.sql`

**Interfaces:**
- Consumes: `is_owner()` / `is_active_staff()` from Task 1.
- Produces: `menu_items.is_archived`, write policies on all menu tables, and the `guard_menu_item_columns` trigger. Tasks 6–8 rely on these being enforced.

Postgres RLS policies cannot restrict *which columns* an update touches, so a barista's narrower permission is enforced by a trigger. Column-level `GRANT`s cannot express it either, because owners and baristas share the single `authenticated` database role.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0003_menu_write_policies.sql`:

```sql
alter table menu_items add column is_archived boolean not null default false;

-- Archived items disappear from the public menu. Replaces the Plan 1 policy,
-- which predated this column.
drop policy "public reads items in active categories" on menu_items;

create policy "public reads live items in active categories"
  on menu_items for select using (
    not is_archived
    and exists (
      select 1 from menu_categories c
      where c.id = menu_items.category_id and c.is_active
    )
  );

-- Staff see everything, archived included, so the owner can un-archive.
create policy "staff read all items"
  on menu_items for select using (public.is_active_staff());

create policy "staff read all categories"
  on menu_categories for select using (public.is_active_staff());

-- Writes. Any active staff member may update an item row; the trigger below
-- decides which columns a barista is actually allowed to have changed.
create policy "staff update items"
  on menu_items for update using (public.is_active_staff());

create policy "owner inserts items"
  on menu_items for insert with check (public.is_owner());

create policy "owner deletes items"
  on menu_items for delete using (public.is_owner());

create policy "owner writes categories"
  on menu_categories for all using (public.is_owner()) with check (public.is_owner());

create policy "owner writes prices"
  on menu_item_prices for all using (public.is_owner()) with check (public.is_owner());

create policy "owner writes modifier groups"
  on modifier_groups for all using (public.is_owner()) with check (public.is_owner());

create policy "owner writes modifiers"
  on modifiers for all using (public.is_owner()) with check (public.is_owner());

-- A barista may flip availability and nothing else. Without this, the
-- "staff update items" policy above would let a barista rename a drink or
-- clear its photo.
create or replace function public.guard_menu_item_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_owner() then
    return new;
  end if;

  if new.id            is distinct from old.id
     or new.category_id   is distinct from old.category_id
     or new.name          is distinct from old.name
     or new.description   is distinct from old.description
     or new.image_path    is distinct from old.image_path
     or new.is_bestseller is distinct from old.is_bestseller
     or new.sort_order    is distinct from old.sort_order
     or new.is_archived   is distinct from old.is_archived
  then
    raise exception 'Only an owner may change menu item fields other than availability'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger guard_menu_item_columns_trg
  before update on menu_items
  for each row execute function public.guard_menu_item_columns();
```

- [ ] **Step 2: Apply it**

```bash
python3 -c "import io,json;print(json.dumps({'query':io.open('supabase/migrations/0003_menu_write_policies.sql').read()}))" > /tmp/m3.json
curl -s -X POST "https://api.supabase.com/v1/projects/lgyfijnfbccifozpnbij/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" --data-binary @/tmp/m3.json
```

Expected: `[]`.

- [ ] **Step 3: Prove the public menu still works and anon still cannot write**

```bash
set -a; . ./.env.local; set +a
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/menu_items?select=name&limit=3" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY"

curl -s -X PATCH "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/menu_items?name=eq.Americano" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" -d '{"name":"Free Coffee"}'
```

Expected: three drink names, then a `42501` row-level-security error.

- [ ] **Step 4: Prove a barista cannot rename a drink**

Create a barista via the bootstrap script pattern, sign in as them through the REST auth endpoint to get an access token, then attempt both writes:

```bash
BARISTA_JWT=$(curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"barista@example.com","password":"<password>"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# allowed
curl -s -X PATCH "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/menu_items?name=eq.Americano" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Authorization: Bearer $BARISTA_JWT" \
  -H "Content-Type: application/json" -d '{"is_available":false}'

# denied
curl -s -X PATCH "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/menu_items?name=eq.Americano" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Authorization: Bearer $BARISTA_JWT" \
  -H "Content-Type: application/json" -d '{"name":"Free Coffee"}'
```

Expected: the availability update succeeds; the rename returns `Only an owner may change menu item fields other than availability`. Restore availability afterwards.

**If the rename succeeds, stop.** The whole role model is decorative until this fails correctly.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add menu write policies and barista column-guard trigger"
```

---

### Task 6: Admin menu list with availability toggle

**Files:**
- Create: `app/admin/menu/page.tsx`, `app/admin/menu/actions.ts`, `components/admin/AvailabilityToggle.tsx`
- Test: `app/admin/menu/actions.test.ts`

**Interfaces:**
- Consumes: `requireStaff()`, `requireOwner()`, `formatPesos()`, `MenuCategoryWithItems`.
- Produces: `getAdminMenu()`, `setAvailability(itemId, isAvailable)`, and `priceRange(item)`. Task 7 adds item mutations to the same actions file.

- [ ] **Step 1: Write the failing test for the price-range helper**

Create `app/admin/menu/actions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { priceRange } from './actions'

describe('priceRange', () => {
  it('shows a range when sizes differ', () => {
    expect(
      priceRange([
        { size: 'M', priceCentavos: 8000 },
        { size: 'XL', priceCentavos: 10000 },
      ]),
    ).toBe('₱80 – ₱100')
  })

  it('shows one price when every size costs the same', () => {
    expect(
      priceRange([
        { size: 'M', priceCentavos: 10500 },
        { size: 'L', priceCentavos: 10500 },
      ]),
    ).toBe('₱105')
  })

  it('flags an item with no prices set', () => {
    expect(priceRange([])).toBe('No price set')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test app/admin/menu/actions.test.ts`
Expected: FAIL — `priceRange` is not exported.

- [ ] **Step 3: Implement the read and the toggle**

Create `app/admin/menu/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { getServerClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/auth/session'
import { formatPesos } from '@/lib/money'
import { mapMenuRows } from '@/lib/menu/queries'
import type { MenuCategoryWithItems, MenuItemPrice } from '@/lib/menu/types'

export function priceRange(prices: MenuItemPrice[]): string {
  if (prices.length === 0) return 'No price set'
  const values = prices.map((p) => p.priceCentavos)
  const low = Math.min(...values)
  const high = Math.max(...values)
  return low === high ? formatPesos(low) : `${formatPesos(low)} – ${formatPesos(high)}`
}

export async function getAdminMenu(): Promise<MenuCategoryWithItems[]> {
  await requireStaff()
  const db = await getServerClient()

  const { data, error } = await db
    .from('menu_categories')
    .select(
      `id, name, sort_order,
       menu_items ( id, name, description, image_path, is_bestseller,
                    is_available, sort_order,
                    menu_item_prices ( size, price_centavos ) )`,
    )
    .order('sort_order')

  if (error) throw new Error(`Failed to load menu: ${error.message}`)
  return mapMenuRows((data ?? []) as never)
}

export async function setAvailability(itemId: string, isAvailable: boolean) {
  await requireStaff()
  const db = await getServerClient()

  const { error } = await db
    .from('menu_items')
    .update({ is_available: isAvailable })
    .eq('id', itemId)

  if (error) throw new Error(`Could not update availability: ${error.message}`)

  revalidatePath('/admin/menu')
  revalidatePath('/')
}
```

`setAvailability` runs as the signed-in user, not the service role, so RLS and the trigger from Task 5 remain in force. That is deliberate — it means a bug in this file cannot grant a barista owner powers.

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npm test app/admin/menu/actions.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Build the toggle component**

Create `components/admin/AvailabilityToggle.tsx`:

```tsx
'use client'

import { useTransition } from 'react'
import { setAvailability } from '@/app/admin/menu/actions'

export function AvailabilityToggle({
  itemId,
  isAvailable,
}: {
  itemId: string
  isAvailable: boolean
}) {
  const [pending, startTransition] = useTransition()

  return (
    <button
      type="button"
      className={isAvailable ? 'btn btn-secondary' : 'btn btn-primary'}
      disabled={pending}
      onClick={() => startTransition(() => setAvailability(itemId, !isAvailable))}
    >
      {pending ? 'Saving…' : isAvailable ? 'Mark sold out' : 'Mark available'}
    </button>
  )
}
```

- [ ] **Step 6: Build the menu page**

Create `app/admin/menu/page.tsx`. It renders cards on phones and a table from 921px up, per `admin.css`.

```tsx
import Link from 'next/link'
import { getCurrentStaff } from '@/lib/auth/session'
import { getAdminMenu, priceRange } from './actions'
import { AvailabilityToggle } from '@/components/admin/AvailabilityToggle'

export default async function AdminMenuPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>
}) {
  const { denied } = await searchParams
  const staff = await getCurrentStaff()
  const categories = await getAdminMenu()
  const isOwner = staff?.role === 'owner'

  return (
    <>
      <h1>Menu</h1>
      {denied === 'owner-only' ? (
        <p className="admin-notice" role="alert">
          Only the owner can edit menu items and prices. You can still mark items
          sold out.
        </p>
      ) : null}

      {categories.map((category) => (
        <section key={category.id}>
          <h2>{category.name}</h2>

          <div className="admin-cards">
            {category.items.map((item) => (
              <article className="section-card" key={item.id}>
                <strong>
                  {item.name}
                  {item.isBestseller ? ' ★' : ''}
                </strong>
                <p>{priceRange(item.prices)}</p>
                <p>{item.isAvailable ? 'Available' : 'Sold out'}</p>
                <AvailabilityToggle itemId={item.id} isAvailable={item.isAvailable} />
                {isOwner ? <Link href={`/admin/menu/${item.id}`}>Edit</Link> : null}
              </article>
            ))}
          </div>

          <table className="admin-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Price</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {category.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.name}
                    {item.isBestseller ? ' ★' : ''}
                  </td>
                  <td>{priceRange(item.prices)}</td>
                  <td>{item.isAvailable ? 'Available' : 'Sold out'}</td>
                  <td>
                    <AvailabilityToggle
                      itemId={item.id}
                      isAvailable={item.isAvailable}
                    />
                    {isOwner ? (
                      <Link href={`/admin/menu/${item.id}`}>Edit</Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  )
}
```

- [ ] **Step 7: Verify end to end**

Sign in as the owner, mark Americano sold out, and confirm:

1. The admin row reads "Sold out".
2. The public `/` shows Americano greyed with "Sold out" — `revalidatePath('/')` fired.
3. Mark it available again and confirm both revert.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add admin menu list with availability toggle"
```

---

### Task 7: Menu item editor and category management (owner only)

**Files:**
- Create: `app/admin/menu/[id]/page.tsx`, `app/admin/menu/new/page.tsx`, `components/admin/MenuItemForm.tsx`
- Modify: `app/admin/menu/actions.ts`
- Test: `app/admin/menu/item-form.test.ts`

**Interfaces:**
- Consumes: `requireOwner()`, `DrinkSize`.
- Produces: `saveMenuItem(formData)`, `archiveMenuItem(id)`, `parsePriceInput(raw)`, `parseSizePrices(formData)`.

- [ ] **Step 1: Write the failing tests for price parsing**

Prices arrive as text from a form and must land as integer centavos. Create `app/admin/menu/item-form.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parsePriceInput } from './actions'

describe('parsePriceInput', () => {
  it('parses a whole peso amount to centavos', () => {
    expect(parsePriceInput('105')).toBe(10500)
  })

  it('parses a decimal amount', () => {
    expect(parsePriceInput('95.50')).toBe(9550)
  })

  it('tolerates a peso sign, commas, and spaces', () => {
    expect(parsePriceInput(' ₱1,234.50 ')).toBe(123450)
  })

  it('treats an empty value as "size not offered"', () => {
    expect(parsePriceInput('')).toBeNull()
    expect(parsePriceInput('   ')).toBeNull()
  })

  it('rejects a negative amount', () => {
    expect(() => parsePriceInput('-5')).toThrow('cannot be negative')
  })

  it('rejects non-numeric text', () => {
    expect(() => parsePriceInput('free')).toThrow('is not a valid price')
  })

  it('rejects fractions of a centavo', () => {
    expect(() => parsePriceInput('10.555')).toThrow('more than two decimal places')
  })
})
```

The rounding case matters: `10.555 * 100` is `1055.4999…` in floating point, so a naive `Math.round` silently loses a centavo.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npm test app/admin/menu/item-form.test.ts`
Expected: FAIL — `parsePriceInput` is not exported.

- [ ] **Step 3: Implement parsing and the save action**

Append to `app/admin/menu/actions.ts`. **Merge these imports into the existing
import block at the top of the file** — an `import` part-way down the file is a
syntax error:

```ts
// merge into the existing imports at the top:
import { redirect } from 'next/navigation'
import { requireOwner } from '@/lib/auth/session'
import type { DrinkSize } from '@/lib/menu/types'

// then append below the existing exports:
const SIZES: DrinkSize[] = ['M', 'L', 'XL', 'HOT']

export function parsePriceInput(raw: string): number | null {
  const cleaned = raw.replace(/[₱,\s]/g, '')
  if (cleaned === '') return null

  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`"${raw.trim()}" is not a valid price`)
  }
  if (cleaned.startsWith('-')) {
    throw new Error('A price cannot be negative')
  }

  const [pesos, decimals = ''] = cleaned.split('.')
  if (decimals.length > 2) {
    throw new Error('A price cannot have more than two decimal places')
  }

  // String maths, not float maths: 10.555 * 100 is 1055.4999... in IEEE 754.
  return Number(pesos) * 100 + Number(decimals.padEnd(2, '0'))
}

export function parseSizePrices(formData: FormData): Record<DrinkSize, number | null> {
  const result = {} as Record<DrinkSize, number | null>
  for (const size of SIZES) {
    result[size] = parsePriceInput(String(formData.get(`price_${size}`) ?? ''))
  }
  return result
}

export async function saveMenuItem(formData: FormData) {
  await requireOwner()
  const db = await getServerClient()

  const id = String(formData.get('id') ?? '') || null
  const name = String(formData.get('name') ?? '').trim()
  const categoryId = String(formData.get('category_id') ?? '')
  const description = String(formData.get('description') ?? '').trim() || null
  const isBestseller = formData.get('is_bestseller') === 'on'

  if (!name) throw new Error('Enter a name for the drink')
  if (!categoryId) throw new Error('Choose a category')

  const prices = parseSizePrices(formData)
  if (Object.values(prices).every((v) => v === null)) {
    throw new Error('Set a price for at least one size')
  }

  const row = {
    name,
    category_id: categoryId,
    description,
    is_bestseller: isBestseller,
    updated_at: new Date().toISOString(),
  }

  const { data: saved, error } = id
    ? await db.from('menu_items').update(row).eq('id', id).select('id').single()
    : await db.from('menu_items').insert(row).select('id').single()

  if (error) throw new Error(`Could not save the drink: ${error.message}`)

  // Sizes set to blank are removed, so "not offered" round-trips correctly.
  const toUpsert = SIZES.filter((s) => prices[s] !== null).map((size) => ({
    menu_item_id: saved.id,
    size,
    price_centavos: prices[size] as number,
  }))
  const toDelete = SIZES.filter((s) => prices[s] === null)

  if (toUpsert.length > 0) {
    const { error: upsertError } = await db
      .from('menu_item_prices')
      .upsert(toUpsert, { onConflict: 'menu_item_id,size' })
    if (upsertError) throw new Error(`Could not save prices: ${upsertError.message}`)
  }

  if (toDelete.length > 0) {
    const { error: deleteError } = await db
      .from('menu_item_prices')
      .delete()
      .eq('menu_item_id', saved.id)
      .in('size', toDelete)
    if (deleteError) throw new Error(`Could not clear prices: ${deleteError.message}`)
  }

  revalidatePath('/admin/menu')
  revalidatePath('/')
  redirect('/admin/menu')
}

export async function archiveMenuItem(id: string) {
  await requireOwner()
  const db = await getServerClient()

  const { error } = await db
    .from('menu_items')
    .update({ is_archived: true, is_available: false })
    .eq('id', id)

  if (error) throw new Error(`Could not archive the drink: ${error.message}`)

  revalidatePath('/admin/menu')
  revalidatePath('/')
}
```

Archiving rather than deleting is what spec §10 calls soft-delete. It also means Plan 3's `order_items` can keep referencing the row after the owner "removes" a drink.

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npm test app/admin/menu/item-form.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Build the form component**

Create `components/admin/MenuItemForm.tsx`:

```tsx
import { saveMenuItem } from '@/app/admin/menu/actions'
import type { DrinkSize, MenuItemWithPrices } from '@/lib/menu/types'

const SIZES: DrinkSize[] = ['M', 'L', 'XL', 'HOT']

export function MenuItemForm({
  item,
  categories,
}: {
  item?: MenuItemWithPrices & { categoryId: string }
  categories: { id: string; name: string }[]
}) {
  const priceFor = (size: DrinkSize) => {
    const match = item?.prices.find((p) => p.size === size)
    return match ? (match.priceCentavos / 100).toString() : ''
  }

  return (
    <form action={saveMenuItem}>
      {item ? <input type="hidden" name="id" value={item.id} /> : null}

      <label className="admin-field">
        <span>Name</span>
        <input name="name" defaultValue={item?.name ?? ''} required />
      </label>

      <label className="admin-field">
        <span>Category</span>
        <select name="category_id" defaultValue={item?.categoryId ?? ''} required>
          <option value="">Choose…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="admin-field">
        <span>Description (optional)</span>
        <textarea name="description" defaultValue={item?.description ?? ''} />
      </label>

      <fieldset>
        <legend>Prices in pesos — leave blank for sizes you do not offer</legend>
        {SIZES.map((size) => (
          <label className="admin-field" key={size}>
            <span>{size}</span>
            <input
              name={`price_${size}`}
              inputMode="decimal"
              defaultValue={priceFor(size)}
              placeholder="—"
            />
          </label>
        ))}
      </fieldset>

      <label className="admin-field">
        <input
          type="checkbox"
          name="is_bestseller"
          defaultChecked={item?.isBestseller ?? false}
        />
        <span>Bestseller (shows a ★)</span>
      </label>

      <p className="admin-notice">
        Price changes apply to future orders only. Orders already placed keep the
        price they were charged.
      </p>

      <button className="btn btn-primary" type="submit">
        Save drink
      </button>
    </form>
  )
}
```

- [ ] **Step 6: Build the edit and create pages**

Create `app/admin/menu/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { requireOwner } from '@/lib/auth/session'
import { getServerClient } from '@/lib/supabase/server'
import { MenuItemForm } from '@/components/admin/MenuItemForm'

export default async function EditMenuItemPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireOwner()
  const { id } = await params
  const db = await getServerClient()

  const { data: item } = await db
    .from('menu_items')
    .select(
      'id, name, description, image_path, is_bestseller, is_available, category_id, menu_item_prices ( size, price_centavos )',
    )
    .eq('id', id)
    .maybeSingle()

  if (!item) notFound()

  const { data: categories } = await db
    .from('menu_categories')
    .select('id, name')
    .order('sort_order')

  return (
    <>
      <h1>Edit {item.name}</h1>
      <MenuItemForm
        categories={categories ?? []}
        item={{
          id: item.id,
          name: item.name,
          description: item.description,
          imagePath: item.image_path,
          isBestseller: item.is_bestseller,
          isAvailable: item.is_available,
          categoryId: item.category_id,
          prices: (item.menu_item_prices ?? []).map(
            (p: { size: string; price_centavos: number }) => ({
              size: p.size as never,
              priceCentavos: p.price_centavos,
            }),
          ),
        }}
      />
    </>
  )
}
```

Create `app/admin/menu/new/page.tsx`:

```tsx
import { requireOwner } from '@/lib/auth/session'
import { getServerClient } from '@/lib/supabase/server'
import { MenuItemForm } from '@/components/admin/MenuItemForm'

export default async function NewMenuItemPage() {
  await requireOwner()
  const db = await getServerClient()

  const { data: categories } = await db
    .from('menu_categories')
    .select('id, name')
    .order('sort_order')

  return (
    <>
      <h1>New drink</h1>
      <p className="admin-notice">
        Save the drink first, then reopen it to add a photo.
      </p>
      <MenuItemForm categories={categories ?? []} />
    </>
  )
}
```

- [ ] **Step 7: Verify a barista is actually blocked**

Sign in as the barista and visit `/admin/menu/<id>` directly. Expected: redirected to `/admin/menu?denied=owner-only` with the notice shown. Then confirm the database also refuses, using the curl from Task 5 Step 4 — the UI redirect alone is not authorisation.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add owner-only menu item editor with per-size pricing"
```

---

### Task 8: Product image upload

**Files:**
- Create: `supabase/migrations/0004_menu_images_bucket.sql`, `lib/images/validate.ts`, `components/admin/ImageUploadField.tsx`
- Modify: `app/admin/menu/actions.ts`, `components/admin/MenuItemForm.tsx`
- Test: `lib/images/validate.test.ts`

**Interfaces:**
- Consumes: `requireOwner()`.
- Produces: `validateImage(bytes, sizeBytes)`, `uploadMenuImage(itemId, file)`, `removeMenuImage(itemId)`, and `menuImageUrl(path)`.

- [ ] **Step 1: Write the bucket migration**

Create `supabase/migrations/0004_menu_images_bucket.sql`:

```sql
-- Public-read, owner-write. Deliberately a SEPARATE bucket from Plan 3's
-- payment-proofs, which is fully private: sharing one bucket would mean making
-- customer payment receipts public in order to serve menu photos.
insert into storage.buckets (id, name, public)
values ('menu-images', 'menu-images', true)
on conflict (id) do nothing;

create policy "public reads menu images"
  on storage.objects for select
  using (bucket_id = 'menu-images');

create policy "owner uploads menu images"
  on storage.objects for insert
  with check (bucket_id = 'menu-images' and public.is_owner());

create policy "owner replaces menu images"
  on storage.objects for update
  using (bucket_id = 'menu-images' and public.is_owner());

create policy "owner deletes menu images"
  on storage.objects for delete
  using (bucket_id = 'menu-images' and public.is_owner());
```

- [ ] **Step 2: Apply it**

```bash
python3 -c "import io,json;print(json.dumps({'query':io.open('supabase/migrations/0004_menu_images_bucket.sql').read()}))" > /tmp/m4.json
curl -s -X POST "https://api.supabase.com/v1/projects/lgyfijnfbccifozpnbij/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" --data-binary @/tmp/m4.json
```

Expected: `[]`.

- [ ] **Step 3: Write the failing tests for image validation**

Create `lib/images/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { validateImage } from './validate'

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])

function webp() {
  const bytes = new Uint8Array(16)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
  bytes.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
  return bytes
}

function heic() {
  const bytes = new Uint8Array(16)
  bytes.set([0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 4) // ftypheic
  return bytes
}

describe('validateImage', () => {
  it('accepts a JPEG', () => {
    expect(validateImage(jpeg, 1000)).toEqual({ ok: true, contentType: 'image/jpeg', extension: 'jpg' })
  })

  it('accepts a PNG', () => {
    expect(validateImage(png, 1000).ok).toBe(true)
  })

  it('accepts a WebP', () => {
    expect(validateImage(webp(), 1000).ok).toBe(true)
  })

  it('rejects HEIC with an explanation, not a generic failure', () => {
    const result = validateImage(heic(), 1000)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('HEIC')
  })

  it('rejects a file over 5MB', () => {
    const result = validateImage(jpeg, 5 * 1024 * 1024 + 1)
    expect(result.ok === false && result.error).toContain('5MB')
  })

  it('rejects content whose bytes are not an image at all', () => {
    const result = validateImage(new Uint8Array([0x3c, 0x3f, 0x70, 0x68, 0x70]), 1000)
    expect(result.ok).toBe(false)
  })
})
```

The last case is the point of byte-sniffing: a PHP script renamed `photo.jpg` passes any extension or MIME check the client supplies.

- [ ] **Step 4: Run them and confirm they fail**

Run: `npm test lib/images/validate.test.ts`
Expected: FAIL — `validateImage` is not exported.

- [ ] **Step 5: Implement validation**

Create `lib/images/validate.ts`:

```ts
export type ImageValidation =
  | { ok: true; contentType: string; extension: string }
  | { ok: false; error: string }

const MAX_BYTES = 5 * 1024 * 1024

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, i) => bytes[offset + i] === byte)
}

export function validateImage(bytes: Uint8Array, sizeBytes: number): ImageValidation {
  if (sizeBytes > MAX_BYTES) {
    return { ok: false, error: 'That image is larger than 5MB. Try a smaller photo.' }
  }

  // Checked before the accept list so iPhone users get a real explanation.
  const heicBrands = ['heic', 'heix', 'hevc', 'mif1']
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...bytes.slice(8, 12))
    if (heicBrands.includes(brand)) {
      return {
        ok: false,
        error:
          'That is a HEIC photo, which browsers cannot display. On iPhone, set ' +
          'Camera > Formats to "Most Compatible", or export it as JPEG first.',
      }
    }
  }

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { ok: true, contentType: 'image/jpeg', extension: 'jpg' }
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ok: true, contentType: 'image/png', extension: 'png' }
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return { ok: true, contentType: 'image/webp', extension: 'webp' }
  }

  return { ok: false, error: 'That file is not a JPEG, PNG, or WebP image.' }
}
```

- [ ] **Step 6: Run tests and confirm they pass**

Run: `npm test lib/images/validate.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Implement the upload actions**

Append to `app/admin/menu/actions.ts`, again merging the import into the block
at the top of the file rather than writing it inline:

```ts
// merge into the existing imports at the top:
import { validateImage } from '@/lib/images/validate'

// then append below the existing exports:
const IMAGE_BUCKET = 'menu-images'

export function menuImageUrl(path: string | null): string | null {
  if (!path) return null
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  return `${base}/storage/v1/object/public/${IMAGE_BUCKET}/${path}`
}

export async function uploadMenuImage(itemId: string, file: File) {
  await requireOwner()
  const db = await getServerClient()

  const bytes = new Uint8Array(await file.arrayBuffer())
  const check = validateImage(bytes, file.size)
  if (!check.ok) throw new Error(check.error)

  const { data: existing } = await db
    .from('menu_items')
    .select('image_path')
    .eq('id', itemId)
    .maybeSingle()

  // A fresh UUID per upload, so a replacement never collides with a
  // CDN-cached predecessor and the new photo shows immediately.
  const path = `menu/${itemId}/${crypto.randomUUID()}.${check.extension}`

  const { error: uploadError } = await db.storage
    .from(IMAGE_BUCKET)
    .upload(path, bytes, { contentType: check.contentType, upsert: false })
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

  const { error: updateError } = await db
    .from('menu_items')
    .update({ image_path: path })
    .eq('id', itemId)

  if (updateError) {
    // Roll the object back so a failed update does not leave a billed orphan.
    await db.storage.from(IMAGE_BUCKET).remove([path])
    throw new Error(`Could not attach the image: ${updateError.message}`)
  }

  if (existing?.image_path) {
    await db.storage.from(IMAGE_BUCKET).remove([existing.image_path])
  }

  revalidatePath('/admin/menu')
  revalidatePath('/')
}

export async function removeMenuImage(itemId: string) {
  await requireOwner()
  const db = await getServerClient()

  const { data: existing } = await db
    .from('menu_items')
    .select('image_path')
    .eq('id', itemId)
    .maybeSingle()

  const { error } = await db
    .from('menu_items')
    .update({ image_path: null })
    .eq('id', itemId)
  if (error) throw new Error(`Could not remove the image: ${error.message}`)

  if (existing?.image_path) {
    await db.storage.from(IMAGE_BUCKET).remove([existing.image_path])
  }

  revalidatePath('/admin/menu')
  revalidatePath('/')
}
```

- [ ] **Step 8: Build the upload field**

Create `components/admin/ImageUploadField.tsx`. `capture="environment"` makes phones offer the camera, which is how these photos will realistically be taken.

```tsx
'use client'

import { useState, useTransition } from 'react'
import { uploadMenuImage, removeMenuImage } from '@/app/admin/menu/actions'

export function ImageUploadField({
  itemId,
  currentUrl,
}: {
  itemId: string
  currentUrl: string | null
}) {
  const [preview, setPreview] = useState<string | null>(currentUrl)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <div className="admin-field">
      <span>Product photo</span>

      {preview ? (
        <img src={preview} alt="" style={{ maxWidth: '220px', borderRadius: '16px' }} />
      ) : (
        <p>No photo yet.</p>
      )}

      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        disabled={pending}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) return
          setError(null)
          setPreview(URL.createObjectURL(file))
          startTransition(async () => {
            try {
              await uploadMenuImage(itemId, file)
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Upload failed')
              setPreview(currentUrl)
            }
          })
        }}
      />

      {preview ? (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await removeMenuImage(itemId)
              setPreview(null)
            })
          }
        >
          Remove photo
        </button>
      ) : null}

      {error ? (
        <p className="admin-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
```

Render it in `MenuItemForm` when editing an existing item — a new item has no id to attach an upload to, so the field appears only after the first save.

- [ ] **Step 9: Verify uploads and permissions**

1. As owner, upload a JPEG to a drink. Confirm it appears on `/admin/menu` and on `/`.
2. Replace it. Confirm the new photo shows immediately and the old object is gone:
   ```bash
   curl -s "$NEXT_PUBLIC_SUPABASE_URL/storage/v1/object/public/menu-images/<old-path>"
   ```
   Expected: a not-found response.
3. Try uploading a HEIC. Expected: the iPhone-specific message, not a generic failure.
4. As barista, attempt an upload through the storage API directly. Expected: denied by the storage policy.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add owner-only product image upload to Supabase Storage"
```

---

### Task 9: Staff management (owner only)

**Files:**
- Create: `app/admin/staff/page.tsx`, `app/admin/staff/actions.ts`
- Test: `app/admin/staff/actions.test.ts`

**Interfaces:**
- Consumes: `requireOwner()`, `getAdminClient()`.
- Produces: `inviteStaff(formData)`, `setStaffRole(id, role)`, `setStaffActive(id, isActive)`, `canDemote(staff, targetId)`.

- [ ] **Step 1: Write the failing test for the last-owner guard**

Create `app/admin/staff/actions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { canDemote } from './actions'

const owner = { id: 'a', role: 'owner' as const }
const otherOwner = { id: 'b', role: 'owner' as const }
const barista = { id: 'c', role: 'barista' as const }

describe('canDemote', () => {
  it('allows demoting an owner while another owner remains', () => {
    expect(canDemote([owner, otherOwner], 'b')).toBe(true)
  })

  it('refuses to demote the only remaining owner', () => {
    expect(canDemote([owner, barista], 'a')).toBe(false)
  })

  it('always allows changing a barista', () => {
    expect(canDemote([owner, barista], 'c')).toBe(true)
  })
})
```

Without this guard, the owner can demote themselves and lock everyone out of menu editing permanently — recoverable only by running a script against the database.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test app/admin/staff/actions.test.ts`
Expected: FAIL — `canDemote` is not exported.

- [ ] **Step 3: Implement the actions**

Create `app/admin/staff/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { getServerClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { requireOwner } from '@/lib/auth/session'
import type { StaffRole } from '@/lib/auth/types'

type RoleRow = { id: string; role: StaffRole }

export function canDemote(staff: RoleRow[], targetId: string): boolean {
  const target = staff.find((s) => s.id === targetId)
  if (!target || target.role !== 'owner') return true
  return staff.filter((s) => s.role === 'owner').length > 1
}

export async function inviteStaff(formData: FormData) {
  await requireOwner()

  const email = String(formData.get('email') ?? '').trim()
  const fullName = String(formData.get('full_name') ?? '').trim()
  const role = String(formData.get('role') ?? 'barista') as StaffRole

  if (!email || !fullName) throw new Error('Enter a name and an email address')
  if (role !== 'owner' && role !== 'barista') throw new Error('Invalid role')

  // Creating an auth user requires the service role; requireOwner() above is
  // what makes that safe.
  const admin = getAdminClient()
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email)
  if (error) throw new Error(`Could not send the invite: ${error.message}`)

  const { error: insertError } = await admin.from('staff').insert({
    id: data.user.id,
    email,
    full_name: fullName,
    role,
    is_active: true,
  })
  if (insertError) throw new Error(`Could not add the staff row: ${insertError.message}`)

  revalidatePath('/admin/staff')
}

export async function setStaffRole(id: string, role: StaffRole) {
  await requireOwner()
  const db = await getServerClient()

  const { data: all } = await db.from('staff').select('id, role')
  if (role !== 'owner' && !canDemote((all ?? []) as RoleRow[], id)) {
    throw new Error('There must always be at least one owner')
  }

  const { error } = await db.from('staff').update({ role }).eq('id', id)
  if (error) throw new Error(`Could not change the role: ${error.message}`)

  revalidatePath('/admin/staff')
}

export async function setStaffActive(id: string, isActive: boolean) {
  await requireOwner()
  const db = await getServerClient()

  if (!isActive) {
    const { data: all } = await db.from('staff').select('id, role')
    if (!canDemote((all ?? []) as RoleRow[], id)) {
      throw new Error('There must always be at least one active owner')
    }
  }

  const { error } = await db.from('staff').update({ is_active: isActive }).eq('id', id)
  if (error) throw new Error(`Could not update the account: ${error.message}`)

  revalidatePath('/admin/staff')
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npm test app/admin/staff/actions.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Build the staff page**

Create `app/admin/staff/page.tsx`:

```tsx
import { requireOwner } from '@/lib/auth/session'
import { getServerClient } from '@/lib/supabase/server'
import { inviteStaff } from './actions'
import { StaffRow } from '@/components/admin/StaffRow'

export default async function StaffPage() {
  const currentUser = await requireOwner()
  const db = await getServerClient()

  const { data: staff } = await db
    .from('staff')
    .select('id, email, full_name, role, is_active')
    .order('created_at')

  const ownerCount = (staff ?? []).filter(
    (s) => s.role === 'owner' && s.is_active,
  ).length

  return (
    <>
      <h1>Staff</h1>

      <form action={inviteStaff} className="section-card">
        <h2>Invite someone</h2>
        <label className="admin-field">
          <span>Full name</span>
          <input name="full_name" required />
        </label>
        <label className="admin-field">
          <span>Email</span>
          <input name="email" type="email" required />
        </label>
        <label className="admin-field">
          <span>Role</span>
          <select name="role" defaultValue="barista">
            <option value="barista">Barista</option>
            <option value="owner">Owner</option>
          </select>
        </label>
        <button className="btn btn-primary" type="submit">
          Send invite
        </button>
      </form>

      <div className="admin-cards">
        {(staff ?? []).map((member) => (
          <StaffRow
            key={member.id}
            member={{
              id: member.id,
              email: member.email,
              fullName: member.full_name,
              role: member.role,
              isActive: member.is_active,
            }}
            isSelf={member.id === currentUser.id}
            isLastOwner={member.role === 'owner' && ownerCount <= 1}
            layout="card"
          />
        ))}
      </div>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {(staff ?? []).map((member) => (
            <StaffRow
              key={member.id}
              member={{
                id: member.id,
                email: member.email,
                fullName: member.full_name,
                role: member.role,
                isActive: member.is_active,
              }}
              isSelf={member.id === currentUser.id}
              isLastOwner={member.role === 'owner' && ownerCount <= 1}
              layout="row"
            />
          ))}
        </tbody>
      </table>
    </>
  )
}
```

Create `components/admin/StaffRow.tsx`:

```tsx
'use client'

import { useTransition, useState } from 'react'
import { setStaffRole, setStaffActive } from '@/app/admin/staff/actions'
import type { StaffMember, StaffRole } from '@/lib/auth/types'

export function StaffRow({
  member,
  isSelf,
  isLastOwner,
  layout,
}: {
  member: StaffMember
  isSelf: boolean
  isLastOwner: boolean
  layout: 'card' | 'row'
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const run = (fn: () => Promise<void>) =>
    startTransition(async () => {
      setError(null)
      try {
        await fn()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Something went wrong')
      }
    })

  const controls = (
    <>
      <select
        value={member.role}
        disabled={pending || isLastOwner}
        onChange={(event) =>
          run(() => setStaffRole(member.id, event.target.value as StaffRole))
        }
      >
        <option value="barista">Barista</option>
        <option value="owner">Owner</option>
      </select>

      <button
        type="button"
        className="btn btn-secondary"
        disabled={pending || isLastOwner}
        onClick={() => run(() => setStaffActive(member.id, !member.isActive))}
      >
        {member.isActive ? 'Deactivate' : 'Reactivate'}
      </button>

      {isLastOwner ? <small>Last owner — cannot be changed</small> : null}
      {isSelf ? <small>This is you</small> : null}
      {error ? (
        <p className="admin-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  )

  if (layout === 'card') {
    return (
      <article className="section-card">
        <strong>{member.fullName}</strong>
        <p>{member.email}</p>
        <p>
          {member.role} · {member.isActive ? 'Active' : 'Deactivated'}
        </p>
        {controls}
      </article>
    )
  }

  return (
    <tr>
      <td>{member.fullName}</td>
      <td>{member.email}</td>
      <td>{member.role}</td>
      <td>{member.isActive ? 'Active' : 'Deactivated'}</td>
      <td>{controls}</td>
    </tr>
  )
}
```

- [ ] **Step 6: Verify**

1. As owner, invite a barista. Confirm they receive the invite email and appear in the list.
2. Attempt to demote yourself as the only owner. Expected: "There must always be at least one owner".
3. Deactivate the barista, then confirm their existing session is rejected — `mapStaffRow` returns null for `is_active: false`, so they land back on the login page.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add owner-only staff management with last-owner guard"
```

---

### Task 10: Responsive verification and documentation

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `app/admin/admin.css`

- [ ] **Step 1: Check every admin screen at four widths**

At 375, 768, 1024, and 1440px, verify:

| Screen | 375px | 768px | 921px+ |
|---|---|---|---|
| Login | single column, inputs full width | centred card | centred card |
| Menu list | cards, no table, no horizontal scroll | cards | table |
| Item editor | one field per row, price inputs stacked | two columns | two columns |
| Staff | cards | cards | table |

Every button must be at least 44px tall. The page body must never scroll horizontally — if it does, a fixed width or an unwrapped table is the cause.

- [ ] **Step 2: Confirm the public site is unaffected**

Run `npm run build`. `/` must still be `○ (Static)` with a `1m` revalidate. If it became dynamic, the proxy matcher widened — it must stay scoped to `/admin/:path*`.

- [ ] **Step 3: Update CLAUDE.md**

Add an Admin section: routes, the two roles and what each can do, that authorisation is enforced in Postgres via `is_owner()` and the column-guard trigger, that `proxy.ts` does session refresh only (and that `middleware.ts` is deprecated in Next 16), and that `npm run create-owner` bootstraps the first account.

- [ ] **Step 4: Update README.md**

Add the `npm run create-owner -- <email> <password> "<Full Name>"` step after seeding.

- [ ] **Step 5: Run the full suite**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: document the admin, roles, and owner bootstrap"
```

---

## Definition of Done

- [ ] `npm test` passes; `npx tsc --noEmit` clean; `npm run build` succeeds.
- [ ] `/` is still `○ (Static)` with a 1m revalidate.
- [ ] Signed out, `/admin/*` redirects to `/admin/login`.
- [ ] A barista can toggle availability and cannot rename a drink — **verified against the database with a real barista JWT**, not only in the UI.
- [ ] A barista visiting `/admin/menu/<id>` is redirected with an explanation.
- [ ] The owner can create, edit, archive, and re-price drinks; prices round-trip exactly as centavos.
- [ ] The owner can upload, replace, and remove a product photo; replacing deletes the previous object.
- [ ] A HEIC upload is refused with an iPhone-specific explanation.
- [ ] An anon client cannot write `menu-images`; a barista cannot write `menu-images`.
- [ ] The last owner cannot be demoted or deactivated.
- [ ] A deactivated staff member cannot use an existing session.
- [ ] Every admin screen works at 375, 768, 1024, and 1440px with no horizontal scroll.

---

## Deferred to Plan 3

Modifier editing (Add-ons, Milk of Choice, Cream Supreme) is seeded but has no admin UI yet — it lands with Plan 3, where modifiers first affect a customer-visible total. Category creation and reordering are also deferred; the four seeded categories match the printed board, and the owner has no reason to change them before ordering exists.
