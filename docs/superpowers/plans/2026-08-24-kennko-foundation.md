# Kennko Foundation (Plan 1 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the static `index.html` to a Next.js app on Vercel and move the menu into Supabase, so the public site renders its menu from the database with no visual change.

**Architecture:** Next.js App Router with TypeScript, deployed on Vercel. The existing single-file page becomes server components that reuse its exact CSS custom properties and markup. Supabase Postgres holds categories, items, per-size prices, and modifiers, seeded from the printed menu. Public reads go through the anon key under RLS; nothing writes yet.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Supabase (Postgres + RLS), Vitest, Playwright, Vercel.

**Spec:** `docs/superpowers/specs/2026-08-24-kennko-ordering-design.md`

## Global Constraints

- **Money is integer centavos.** `price_centavos`. ₱105 is `10500`. Never floats, never `numeric`, never a string.
- **`type`, never `interface`.** Project-wide TypeScript convention from `~/.claude/CLAUDE.md`.
- **Visual identity is the existing electric blue brand.** Tokens copied verbatim: `--blue: #0055ff`, `--blue-dark: #003fc0`, `--white: #ffffff`, `--amber: #ffb830`, `--text: #0d1b3d`, `--muted: #e8efff`, `--card: rgba(255,255,255,0.92)`, `--shadow: 0 24px 60px rgba(0,40,130,0.18)`, `--radius-xl: 32px`, `--radius-lg: 22px`, `--radius-md: 16px`.
- **Font stack, verbatim:** `Inter, ui-rounded, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- **`brand/Kennko Menu.png` is a data reference only.** Its navy/serif look is NOT the design target.
- **Breakpoints, matching the current site:** `max-width: 920px` (tablet) and `max-width: 640px` (phone). Verify every layout at 375, 768, 1024, and 1440px.
- **Address is `CT. Montalban St., Villa Kananga, Butuan City, Philippines 8600`.** Never "SM Butuan" — the cafe relocated.
- **Customer-facing name is "Kennko Coffee"** (spec §12 q7).
- **No ordering, admin, auth, uploads, or email in this plan.** Those are Plans 2 and 3.

---

## File Structure

| Path | Responsibility |
|---|---|
| `app/layout.tsx` | Root layout, metadata, font, global style import |
| `app/page.tsx` | Marketing page — composes the section components |
| `app/globals.css` | Design tokens + all styles ported from `index.html` |
| `components/site/Nav.tsx` | Top navigation |
| `components/site/Hero.tsx` | Hero section |
| `components/site/About.tsx` | About section |
| `components/site/MenuSection.tsx` | Menu section — DB-driven by Task 8 |
| `components/site/Perks.tsx` | Perks card section |
| `components/site/Visit.tsx` | Location, contact cards, Maps embed |
| `components/site/Footer.tsx` | Footer |
| `lib/money.ts` | Centavo formatting — single source of peso display |
| `lib/supabase/client.ts` | Browser Supabase client (anon key) |
| `lib/supabase/server.ts` | Server Supabase client (anon key, cookie-aware) |
| `lib/menu/types.ts` | `MenuCategory`, `MenuItem`, `MenuItemPrice`, `Modifier` types |
| `lib/menu/queries.ts` | Typed menu reads |
| `supabase/migrations/0001_menu_schema.sql` | Categories, items, prices, modifiers, RLS |
| `supabase/seed/menu.ts` | Seed data transcribed from Appendix A |
| `scripts/seed-menu.ts` | Runnable seeder |
| `public/brand/` | Brand assets copied from `brand/assets/` |

`index.html` is deleted in Task 3, once `app/page.tsx` renders identically.

---

### Task 1: Scaffold Next.js and test infrastructure

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.gitignore` (modify), `app/layout.tsx`, `app/page.tsx`, `lib/money.ts`
- Test: `lib/money.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `formatPesos(centavos: number): string` — used by every later task that displays a price.

- [ ] **Step 1: Scaffold the app**

```bash
npx create-next-app@latest . --typescript --app --no-tailwind --no-src-dir --no-eslint --use-npm --import-alias "@/*"
```

Answer "no" to overwriting `README.md` if prompted. If the CLI refuses to run in a non-empty directory, scaffold into `.next-scaffold/` and move the generated files up, then delete the scaffold dir.

- [ ] **Step 2: Add test dependencies**

```bash
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 3: Configure Vitest**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
```

Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 4: Write the failing test for money formatting**

Create `lib/money.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatPesos } from './money'

describe('formatPesos', () => {
  it('formats whole pesos without decimals', () => {
    expect(formatPesos(10500)).toBe('₱105')
  })

  it('formats centavos with two decimals', () => {
    expect(formatPesos(9550)).toBe('₱95.50')
  })

  it('formats zero', () => {
    expect(formatPesos(0)).toBe('₱0')
  })

  it('adds thousands separators', () => {
    expect(formatPesos(123400)).toBe('₱1,234')
  })

  it('throws on non-integer input', () => {
    expect(() => formatPesos(105.5)).toThrow('centavos must be an integer')
  })

  it('throws on negative input', () => {
    expect(() => formatPesos(-100)).toThrow('centavos must not be negative')
  })
})
```

- [ ] **Step 5: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./money"`.

- [ ] **Step 6: Implement money formatting**

Create `lib/money.ts`:

```ts
export function formatPesos(centavos: number): string {
  if (!Number.isInteger(centavos)) {
    throw new Error('centavos must be an integer')
  }
  if (centavos < 0) {
    throw new Error('centavos must not be negative')
  }

  const pesos = centavos / 100
  const hasFraction = centavos % 100 !== 0

  return `₱${pesos.toLocaleString('en-PH', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}
```

- [ ] **Step 7: Run tests and confirm they pass**

Run: `npm test`
Expected: PASS, 6 tests.

- [ ] **Step 8: Verify the build and dev server**

Run: `npm run build && npm run dev`
Expected: build succeeds; `http://localhost:3000` serves the default Next.js page.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Vitest and money formatting"
```

---

### Task 2: Port design tokens and global styles

**Files:**
- Create: `app/globals.css`
- Modify: `app/layout.tsx`
- Reference: `index.html:12-440` (the `<style>` block)

**Interfaces:**
- Consumes: nothing
- Produces: every CSS class the section components use — `.container`, `.btn`, `.btn-primary`, `.btn-secondary`, `.section-head`, `.section-card`, `.pill`, `.pill-row`, `.eyebrow`, `.kicker`, `.menu-grid`, `.menu-card`, `.menu-list`, `.perks-grid`, `.visit-grid`, `.contact-stack`, `.contact-card`, `.contact-link`, `.map-card`, `.map-frame`, `.map-foot`, `.banner`, `.hero-shell`, `.hero-copy`, `.hero-grid`, `.hero-card`, `.nav-inner`, `.nav-links`, `.footer-shell`.

- [ ] **Step 1: Copy the stylesheet verbatim**

Extract everything between `<style>` and `</style>` in `index.html` into `app/globals.css`. Copy it exactly — do not reformat, rename, or "improve" it. The goal of this task is a byte-faithful visual port; refactoring here makes the diff impossible to review.

- [ ] **Step 2: Fix asset paths**

In `app/globals.css`, rewrite any `url(brand/assets/...)` to `url(/brand/...)`. Then:

```bash
mkdir -p public/brand
cp brand/assets/* public/brand/

# Every source filename contains spaces and mixed case, which need percent
# encoding in a URL and break silently when they are not encoded. Normalise
# to kebab-case once, here, rather than encoding at every call site.
cd public/brand
for f in *; do
  mv -n "$f" "$(echo "$f" | tr '[:upper:] ' '[:lower:]-')"
done
cd -
```

The four images referenced in Task 8 must end up as `egg-coffee.jpg`,
`sea-salt-caramel-oat-latte.jpg`, `strawberry-cloud-soda.jpg`, and
`coconut-series.jpg`. The rename above does not produce those names from the
originals, so rename those four explicitly:

```bash
cd public/brand
mv "egg-coffee-kennco.jpg" egg-coffee.jpg
mv "sea-salt-caramel-oat-latte-primary-kennko.jpg" sea-salt-caramel-oat-latte.jpg
mv "strawberry-cloud-soda-kennco.jpg" strawberry-cloud-soda.jpg
mv "kennko-coconut-series.jpg" coconut-series.jpg
cd -
```

- [ ] **Step 3: Wire the stylesheet and metadata into the layout**

Replace `app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Kennko Coffee — Bold coffee. Fun sips. Good energy.',
  description:
    'Kennko Coffee is a bold, playful cafe on CT. Montalban St., Villa Kananga, Butuan City serving premium coffee, non-coffee favorites, and signature specialty drinks.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 4: Verify tokens survived the copy**

Run:

```bash
grep -c -- '--blue: #0055ff' app/globals.css
grep -c -- '--amber: #ffb830' app/globals.css
grep -c 'max-width: 920px' app/globals.css
grep -c 'max-width: 640px' app/globals.css
```

Expected: `1` for each. If any is `0`, the copy was incomplete — redo Step 1.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: port design tokens and global stylesheet to Next.js"
```

---

### Task 3: Port marketing sections as components

**Files:**
- Create: `components/site/Nav.tsx`, `Hero.tsx`, `About.tsx`, `MenuSection.tsx`, `Perks.tsx`, `Visit.tsx`, `Footer.tsx`
- Modify: `app/page.tsx`
- Delete: `index.html`
- Reference: `index.html:495-755`

**Interfaces:**
- Consumes: CSS classes from Task 2.
- Produces: `<MenuSection />` — Task 8 changes it to accept `categories: MenuCategoryWithItems[]`. Every other component takes no props.

- [ ] **Step 1: Port each section, one component per section**

For each section in `index.html`, copy its markup into the matching component and convert JSX-hostile attributes: `class` → `className`, `for` → `htmlFor`, `style="a:b"` → `style={{ a: 'b' }}`, and self-close `<img>` / `<br>`. Keep the copy text byte-identical — including the curly apostrophes in "You'll" and "Kennko's", and the em dashes. Straightening them is a visible regression.

`components/site/Hero.tsx` is the pattern for the rest:

```tsx
export function Hero() {
  return (
    <section className="hero">
      <div className="container hero-shell">
        <div className="hero-copy">
          <span className="eyebrow">
            Villa Kananga, Butuan City • Premium coffee &amp; playful drinks
          </span>
          {/* ...remainder copied from index.html:510-537... */}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Keep the menu data hardcoded for now**

`MenuSection.tsx` keeps the four hardcoded category cards exactly as `index.html` has them. Task 8 replaces this with database data. Do not anticipate that here — a component that half-reads from a database is harder to verify than one that does not read from it at all.

- [ ] **Step 3: Compose the page**

Replace `app/page.tsx`:

```tsx
import { Nav } from '@/components/site/Nav'
import { Hero } from '@/components/site/Hero'
import { About } from '@/components/site/About'
import { MenuSection } from '@/components/site/MenuSection'
import { Perks } from '@/components/site/Perks'
import { Visit } from '@/components/site/Visit'
import { Footer } from '@/components/site/Footer'

export default function HomePage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <About />
        <MenuSection />
        <Perks />
        <Visit />
      </main>
      <Footer />
    </>
  )
}
```

- [ ] **Step 4: Compare against the original side by side**

Run `npm run dev`, and serve the old file for comparison:

```bash
git show HEAD:index.html > /tmp/kennko-original.html
python3 -m http.server 4321 --directory /tmp &
```

Open both at 375, 768, 1024, and 1440px. They must match: same spacing, same colours, same wrapping, same map aspect ratios. Fix any drift before continuing.

- [ ] **Step 5: Verify the address copy survived**

Run:

```bash
grep -ril "sm butuan" components/ app/ && echo "FAIL: stale address" || echo "OK"
grep -rl "Villa Kananga" components/ | sort
```

Expected: `OK`, and `Villa Kananga` present in `Hero.tsx`, `About.tsx`, `Visit.tsx`, and `Footer.tsx`.

- [ ] **Step 6: Delete the old page**

```bash
git rm index.html
```

- [ ] **Step 7: Build and commit**

```bash
npm run build
git add -A
git commit -m "feat: port marketing page to Next.js components"
```

---

### Task 4: Supabase client and environment configuration

**Files:**
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/env.ts`, `.env.local.example`
- Modify: `.gitignore`
- Test: `lib/env.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `getBrowserClient()`, `getServerClient()`, and `env` — a validated config object. Later tasks import these rather than reading `process.env` directly.

- [ ] **Step 1: Install the Supabase SDK**

```bash
npm install @supabase/supabase-js @supabase/ssr
```

- [ ] **Step 2: Write the failing test for env validation**

Create `lib/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readEnv } from './env'

describe('readEnv', () => {
  it('returns config when all required vars are present', () => {
    const result = readEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    })
    expect(result.supabaseUrl).toBe('https://abc.supabase.co')
    expect(result.supabaseAnonKey).toBe('anon-key')
  })

  it('throws naming the missing variable', () => {
    expect(() =>
      readEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' }),
    ).toThrow('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  })

  it('rejects a non-https supabase url', () => {
    expect(() =>
      readEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'http://abc.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      }),
    ).toThrow('must be https')
  })
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npm test lib/env.test.ts`
Expected: FAIL — cannot resolve `./env`.

- [ ] **Step 4: Implement env validation**

Create `lib/env.ts`:

```ts
export type AppEnv = {
  supabaseUrl: string
  supabaseAnonKey: string
}

export function readEnv(source: Record<string, string | undefined>): AppEnv {
  const url = source.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = source.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL')
  if (!anonKey) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (!url.startsWith('https://')) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must be https')
  }

  return { supabaseUrl: url, supabaseAnonKey: anonKey }
}

export const env = readEnv(process.env)
```

- [ ] **Step 5: Run tests and confirm they pass**

Run: `npm test lib/env.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Create the Supabase clients**

Create `lib/supabase/client.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr'
import { env } from '@/lib/env'

export function getBrowserClient() {
  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey)
}
```

Create `lib/supabase/server.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { env } from '@/lib/env'

export async function getServerClient() {
  const cookieStore = await cookies()

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        try {
          items.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        } catch {
          // Called from a server component, where cookies are read-only.
          // Session refresh is handled by middleware in Plan 2.
        }
      },
    },
  })
}
```

- [ ] **Step 7: Document required env vars**

Create `.env.local.example`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Confirm `.gitignore` contains `.env*.local`. The anon key is public by design, but the service-role key added in Plan 2 is not — establish the habit now.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add Supabase clients and validated env config"
```

---

### Task 5: Menu schema migration with RLS

**Files:**
- Create: `supabase/migrations/0001_menu_schema.sql`

**Interfaces:**
- Consumes: nothing
- Produces: tables `menu_categories`, `menu_items`, `menu_item_prices`, `modifier_groups`, `modifiers`; enum `drink_size`. Task 6 seeds them, Task 7 reads them.

This migration covers only what the public menu needs. `staff`, `orders`, `order_items`, and the storage buckets arrive in Plans 2 and 3 — a migration is easier to review when it serves one plan.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0001_menu_schema.sql`:

```sql
create type drink_size as enum ('M', 'L', 'XL', 'HOT');

create table menu_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort_order int  not null default 0,
  is_active  boolean not null default true
);

create table menu_items (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid not null references menu_categories(id) on delete restrict,
  name          text not null,
  description   text,
  image_path    text,
  is_bestseller boolean not null default false,
  is_available  boolean not null default true,
  sort_order    int not null default 0,
  updated_at    timestamptz not null default now(),
  unique (category_id, name)
);

-- A missing row means that size is not offered: strawberry milk has no HOT,
-- hojicha has no XL.
create table menu_item_prices (
  menu_item_id   uuid not null references menu_items(id) on delete cascade,
  size           drink_size not null,
  price_centavos int not null check (price_centavos >= 0),
  primary key (menu_item_id, size)
);

create table modifier_groups (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  is_multi_select boolean not null,
  sort_order      int not null default 0
);

create table modifiers (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references modifier_groups(id) on delete cascade,
  name           text not null,
  price_centavos int not null check (price_centavos >= 0),
  is_available   boolean not null default true,
  sort_order     int not null default 0,
  unique (group_id, name)
);

create index menu_items_category_idx on menu_items (category_id, sort_order);

-- RLS: the public may read the live menu and nothing else. No write policies
-- exist yet, so every write is denied for anon and authenticated alike until
-- Plan 2 adds owner-scoped policies.
alter table menu_categories  enable row level security;
alter table menu_items       enable row level security;
alter table menu_item_prices enable row level security;
alter table modifier_groups  enable row level security;
alter table modifiers        enable row level security;

create policy "public reads active categories"
  on menu_categories for select using (is_active);

create policy "public reads items in active categories"
  on menu_items for select using (
    exists (
      select 1 from menu_categories c
      where c.id = menu_items.category_id and c.is_active
    )
  );

create policy "public reads prices of visible items"
  on menu_item_prices for select using (
    exists (
      select 1 from menu_items i
      join menu_categories c on c.id = i.category_id
      where i.id = menu_item_prices.menu_item_id and c.is_active
    )
  );

create policy "public reads modifier groups"
  on modifier_groups for select using (true);

create policy "public reads available modifiers"
  on modifiers for select using (is_available);
```

Note `menu_items` is readable regardless of `is_available` — the spec (§7) requires unavailable items to render greyed out rather than vanish, so the client needs to see them.

- [ ] **Step 2: Apply the migration**

```bash
npx supabase db push
```

If the project is not linked yet: `npx supabase login` then `npx supabase link --project-ref <ref>`.

- [ ] **Step 3: Verify RLS actually denies writes**

```bash
curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/menu_categories" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Hacked","sort_order":99}'
```

Expected: a `42501` row-level-security error. If this succeeds, RLS is misconfigured — stop and fix it before seeding. An anon key that can write the menu is an anon key that can rewrite your prices.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add menu schema with public-read RLS policies"
```

---

### Task 6: Seed the menu from the printed board

**Files:**
- Create: `supabase/seed/menu.ts`, `scripts/seed-menu.ts`
- Test: `supabase/seed/menu.test.ts`
- Reference: spec Appendix A

**Interfaces:**
- Consumes: `menu_*` tables from Task 5.
- Produces: `SEED_CATEGORIES`, `SEED_MODIFIER_GROUPS` — also used by Plan 3's tests as fixtures.

- [ ] **Step 1: Transcribe the menu as data**

Create `supabase/seed/menu.ts`. Prices are in centavos — ₱105 is `10500`. `null` means that size is not offered.

```ts
export type SeedPrice = { M: number; L: number; XL: number | null; HOT: number | null }

export type SeedItem = {
  name: string
  isBestseller: boolean
  prices: SeedPrice
}

export type SeedCategory = {
  name: string
  sortOrder: number
  items: SeedItem[]
}

const p = (m: number, l: number, xl: number | null, hot: number | null): SeedPrice => ({
  M: m * 100,
  L: l * 100,
  XL: xl === null ? null : xl * 100,
  HOT: hot === null ? null : hot * 100,
})

export const SEED_CATEGORIES: SeedCategory[] = [
  {
    name: 'Premium Classics',
    sortOrder: 0,
    items: [
      { name: 'Americano',         isBestseller: false, prices: p(80, 90, 100, 95) },
      { name: 'Café Latte',        isBestseller: false, prices: p(100, 115, 130, 125) },
      { name: 'Vanilla Latte',     isBestseller: false, prices: p(105, 125, 135, 135) },
      { name: 'Hazelnut Latte',    isBestseller: false, prices: p(105, 125, 135, 135) },
      { name: 'Spanish Latte',     isBestseller: true,  prices: p(105, 125, 135, 135) },
      { name: 'White Café Mocha',  isBestseller: true,  prices: p(110, 130, 140, 135) },
      { name: 'Dark Café Mocha',   isBestseller: false, prices: p(110, 130, 140, 135) },
      { name: 'Caramel Macchiato', isBestseller: true,  prices: p(110, 130, 140, 135) },
    ],
  },
  {
    name: "Barista's Choice",
    sortOrder: 1,
    items: [
      { name: 'Vietnamese Coffee',    isBestseller: false, prices: p(110, 130, 140, 135) },
      { name: 'Egg Coffee',           isBestseller: true,  prices: p(125, 145, 165, 155) },
      { name: 'Coconut Coffee',       isBestseller: false, prices: p(125, 145, 160, 155) },
      { name: 'Sea Salt Caramel Oat', isBestseller: true,  prices: p(130, 150, 170, 160) },
      { name: 'Honey Oat Latte',      isBestseller: false, prices: p(130, 150, 170, 160) },
    ],
  },
  {
    name: 'Sweet Sips',
    sortOrder: 2,
    items: [
      { name: 'Strawberry Milk',   isBestseller: true,  prices: p(105, 125, 135, null) },
      { name: 'Strawberry Matcha', isBestseller: true,  prices: p(125, 145, 155, null) },
      { name: 'Signature Choco',   isBestseller: true,  prices: p(105, 125, 135, 135) },
      { name: 'Choco-Coconut',     isBestseller: true,  prices: p(125, 145, 155, null) },
      { name: 'Vanilla Milk',      isBestseller: false, prices: p(105, 125, 135, 135) },
    ],
  },
  {
    name: 'Matcha Series',
    sortOrder: 3,
    items: [
      { name: 'Matcha',       isBestseller: true,  prices: p(115, 135, 145, 145) },
      { name: 'Matcha Coco',  isBestseller: false, prices: p(135, 155, 175, 165) },
      { name: 'Dirty Matcha', isBestseller: false, prices: p(140, 160, 180, 170) },
      { name: 'Hojicha',      isBestseller: true,  prices: p(140, 160, null, 160) },
    ],
  },
]

export type SeedModifierGroup = {
  name: string
  isMultiSelect: boolean
  sortOrder: number
  modifiers: { name: string; priceCentavos: number }[]
}

export const SEED_MODIFIER_GROUPS: SeedModifierGroup[] = [
  {
    name: 'Add-ons',
    isMultiSelect: true,
    sortOrder: 0,
    modifiers: [
      { name: 'Espresso Shots', priceCentavos: 3500 },
      { name: 'Milk',           priceCentavos: 2000 },
      { name: 'Sugar Syrup',    priceCentavos: 2000 },
      { name: 'Milk Syrup',     priceCentavos: 2500 },
      { name: 'Flavor Sauce',   priceCentavos: 3000 },
    ],
  },
  {
    name: 'Milk of Choice',
    isMultiSelect: false,
    sortOrder: 1,
    modifiers: [
      { name: 'Oat Milk', priceCentavos: 4000 },
      { name: 'Soy Milk', priceCentavos: 3500 },
    ],
  },
  {
    name: 'Cream Supreme',
    isMultiSelect: false,
    sortOrder: 2,
    modifiers: [
      { name: 'Salty Vanilla Cream', priceCentavos: 5000 },
      { name: 'Choco Cream',         priceCentavos: 4500 },
      { name: 'Matcha Cream',        priceCentavos: 6500 },
      { name: 'Coconut Cream',       priceCentavos: 5000 },
    ],
  },
]
```

- [ ] **Step 2: Write the failing test guarding the transcription**

A typo here charges customers the wrong price, so the data is tested rather than trusted. Create `supabase/seed/menu.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SEED_CATEGORIES, SEED_MODIFIER_GROUPS } from './menu'

describe('menu seed data', () => {
  it('has the four printed categories in board order', () => {
    expect(SEED_CATEGORIES.map((c) => c.name)).toEqual([
      'Premium Classics',
      "Barista's Choice",
      'Sweet Sips',
      'Matcha Series',
    ])
  })

  it('has 22 drinks', () => {
    const total = SEED_CATEGORIES.reduce((n, c) => n + c.items.length, 0)
    expect(total).toBe(22)
  })

  it('marks 9 bestsellers', () => {
    const stars = SEED_CATEGORIES.flatMap((c) => c.items).filter((i) => i.isBestseller)
    expect(stars).toHaveLength(9)
  })

  it('prices the cheapest and priciest items correctly', () => {
    const items = SEED_CATEGORIES.flatMap((c) => c.items)
    const americano = items.find((i) => i.name === 'Americano')
    expect(americano?.prices).toEqual({ M: 8000, L: 9000, XL: 10000, HOT: 9500 })

    const dirty = items.find((i) => i.name === 'Dirty Matcha')
    expect(dirty?.prices).toEqual({ M: 14000, L: 16000, XL: 18000, HOT: 17000 })
  })

  it('omits sizes the board does not offer', () => {
    const items = SEED_CATEGORIES.flatMap((c) => c.items)
    expect(items.find((i) => i.name === 'Strawberry Milk')?.prices.HOT).toBeNull()
    expect(items.find((i) => i.name === 'Choco-Coconut')?.prices.HOT).toBeNull()
    expect(items.find((i) => i.name === 'Hojicha')?.prices.XL).toBeNull()
  })

  it('stores every price as a whole number of centavos', () => {
    for (const item of SEED_CATEGORIES.flatMap((c) => c.items)) {
      for (const value of Object.values(item.prices)) {
        if (value === null) continue
        expect(Number.isInteger(value)).toBe(true)
        expect(value % 100).toBe(0)
      }
    }
  })

  it('has 11 modifiers across 3 groups', () => {
    expect(SEED_MODIFIER_GROUPS).toHaveLength(3)
    const total = SEED_MODIFIER_GROUPS.reduce((n, g) => n + g.modifiers.length, 0)
    expect(total).toBe(11)
  })

  it('makes only Add-ons multi-select', () => {
    const multi = SEED_MODIFIER_GROUPS.filter((g) => g.isMultiSelect)
    expect(multi.map((g) => g.name)).toEqual(['Add-ons'])
  })
})
```

- [ ] **Step 3: Run it and confirm it passes**

Run: `npm test supabase/seed/menu.test.ts`
Expected: PASS, 8 tests. If a price assertion fails, re-read Appendix A — the test is right and the transcription is wrong.

- [ ] **Step 4: Write the seeder**

Create `scripts/seed-menu.ts`. It requires the service-role key, since RLS grants no write access to anon.

```ts
import { createClient } from '@supabase/supabase-js'
import { SEED_CATEGORIES, SEED_MODIFIER_GROUPS } from '../supabase/seed/menu'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
}

const db = createClient(url, serviceKey)

async function main() {
  for (const category of SEED_CATEGORIES) {
    const { data: cat, error: catError } = await db
      .from('menu_categories')
      .upsert({ name: category.name, sort_order: category.sortOrder }, { onConflict: 'name' })
      .select('id')
      .single()
    if (catError) throw catError

    for (const [index, item] of category.items.entries()) {
      const { data: row, error: itemError } = await db
        .from('menu_items')
        .upsert(
          {
            category_id: cat.id,
            name: item.name,
            is_bestseller: item.isBestseller,
            sort_order: index,
          },
          { onConflict: 'category_id,name' },
        )
        .select('id')
        .single()
      if (itemError) throw itemError

      const priceRows = Object.entries(item.prices)
        .filter(([, value]) => value !== null)
        .map(([size, value]) => ({
          menu_item_id: row.id,
          size,
          price_centavos: value as number,
        }))

      const { error: priceError } = await db
        .from('menu_item_prices')
        .upsert(priceRows, { onConflict: 'menu_item_id,size' })
      if (priceError) throw priceError
    }
  }

  for (const group of SEED_MODIFIER_GROUPS) {
    const { data: grp, error: groupError } = await db
      .from('modifier_groups')
      .upsert(
        { name: group.name, is_multi_select: group.isMultiSelect, sort_order: group.sortOrder },
        { onConflict: 'name' },
      )
      .select('id')
      .single()
    if (groupError) throw groupError

    const { error: modError } = await db.from('modifiers').upsert(
      group.modifiers.map((m, i) => ({
        group_id: grp.id,
        name: m.name,
        price_centavos: m.priceCentavos,
        sort_order: i,
      })),
      { onConflict: 'group_id,name' },
    )
    if (modError) throw modError
  }

  console.log('Seeded 4 categories, 22 items, 11 modifiers.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

Add to `package.json` scripts: `"seed": "tsx scripts/seed-menu.ts"`, and `npm install -D tsx`.

The seeder upserts on natural keys, so re-running it corrects drifted data instead of duplicating rows.

- [ ] **Step 5: Run the seeder**

```bash
export SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # never commit this
npm run seed
```

Expected: `Seeded 4 categories, 22 items, 11 modifiers.`

- [ ] **Step 6: Verify counts in the database**

```bash
npx supabase db shell --command \
  "select (select count(*) from menu_categories) cats,
          (select count(*) from menu_items) items,
          (select count(*) from menu_item_prices) prices,
          (select count(*) from modifiers) mods;"
```

Expected: `cats=4, items=22, prices=84, mods=11`.

84 = 22 items × 4 sizes (88), minus the 4 cells the board does not offer: no HOT
for Strawberry Milk, Strawberry Matcha, or Choco-Coconut, and no XL for Hojicha.
If this returns 88, the seeder wrote rows for unoffered sizes and the `null`
filter in Step 4 is broken.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: seed menu from printed board with transcription tests"
```

---

### Task 7: Typed menu queries

**Files:**
- Create: `lib/menu/types.ts`, `lib/menu/queries.ts`
- Test: `lib/menu/queries.test.ts`

**Interfaces:**
- Consumes: `getServerClient()` from Task 4; seeded tables from Task 6.
- Produces: `getMenu(): Promise<MenuCategoryWithItems[]>` and the types `MenuCategoryWithItems`, `MenuItemWithPrices`, `DrinkSize`. Task 8 and all of Plan 3 consume these.

- [ ] **Step 1: Define the types**

Create `lib/menu/types.ts`:

```ts
export type DrinkSize = 'M' | 'L' | 'XL' | 'HOT'

export type MenuItemPrice = {
  size: DrinkSize
  priceCentavos: number
}

export type MenuItemWithPrices = {
  id: string
  name: string
  description: string | null
  imagePath: string | null
  isBestseller: boolean
  isAvailable: boolean
  prices: MenuItemPrice[]
}

export type MenuCategoryWithItems = {
  id: string
  name: string
  items: MenuItemWithPrices[]
}
```

- [ ] **Step 2: Write the failing test for the row mapper**

The mapper is tested in isolation, so the test needs no database. Create `lib/menu/queries.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mapMenuRows } from './queries'

const rows = [
  {
    id: 'cat-1',
    name: 'Premium Classics',
    sort_order: 0,
    menu_items: [
      {
        id: 'item-1',
        name: 'Americano',
        description: null,
        image_path: null,
        is_bestseller: false,
        is_available: true,
        sort_order: 0,
        menu_item_prices: [
          { size: 'L', price_centavos: 9000 },
          { size: 'M', price_centavos: 8000 },
        ],
      },
    ],
  },
]

describe('mapMenuRows', () => {
  it('maps snake_case rows to camelCase domain types', () => {
    const [category] = mapMenuRows(rows)
    expect(category.name).toBe('Premium Classics')
    expect(category.items[0].isBestseller).toBe(false)
    expect(category.items[0].prices[0].priceCentavos).toBe(8000)
  })

  it('orders prices M, L, XL, HOT regardless of row order', () => {
    const [category] = mapMenuRows(rows)
    expect(category.items[0].prices.map((p) => p.size)).toEqual(['M', 'L'])
  })

  it('returns an empty list for no rows', () => {
    expect(mapMenuRows([])).toEqual([])
  })
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npm test lib/menu/queries.test.ts`
Expected: FAIL — `mapMenuRows` is not exported.

- [ ] **Step 4: Implement the queries**

Create `lib/menu/queries.ts`:

```ts
import { getServerClient } from '@/lib/supabase/server'
import type { DrinkSize, MenuCategoryWithItems } from './types'

const SIZE_ORDER: DrinkSize[] = ['M', 'L', 'XL', 'HOT']

type PriceRow = { size: string; price_centavos: number }
type ItemRow = {
  id: string
  name: string
  description: string | null
  image_path: string | null
  is_bestseller: boolean
  is_available: boolean
  sort_order: number
  menu_item_prices: PriceRow[]
}
type CategoryRow = {
  id: string
  name: string
  sort_order: number
  menu_items: ItemRow[]
}

export function mapMenuRows(rows: CategoryRow[]): MenuCategoryWithItems[] {
  return rows.map((category) => ({
    id: category.id,
    name: category.name,
    items: [...category.menu_items]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        imagePath: item.image_path,
        isBestseller: item.is_bestseller,
        isAvailable: item.is_available,
        prices: [...item.menu_item_prices]
          .sort(
            (a, b) =>
              SIZE_ORDER.indexOf(a.size as DrinkSize) -
              SIZE_ORDER.indexOf(b.size as DrinkSize),
          )
          .map((price) => ({
            size: price.size as DrinkSize,
            priceCentavos: price.price_centavos,
          })),
      })),
  }))
}

export async function getMenu(): Promise<MenuCategoryWithItems[]> {
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

  return mapMenuRows((data ?? []) as CategoryRow[])
}
```

- [ ] **Step 5: Run tests and confirm they pass**

Run: `npm test lib/menu/queries.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add typed menu queries"
```

---

### Task 8: Render the public menu from the database

**Files:**
- Modify: `components/site/MenuSection.tsx`, `app/page.tsx`

**Interfaces:**
- Consumes: `getMenu()` and `MenuCategoryWithItems` from Task 7; `formatPesos()` from Task 1.
- Produces: `<MenuSection categories={...} />`.

- [ ] **Step 1: Take categories as a prop**

Rewrite `components/site/MenuSection.tsx`. It keeps the `.menu-grid` / `.menu-card` / `.menu-list` classes from Task 2 so the section looks unchanged, but each item now shows its starting price.

```tsx
import { formatPesos } from '@/lib/money'
import type { MenuCategoryWithItems } from '@/lib/menu/types'

const CATEGORY_IMAGES: Record<string, string> = {
  'Premium Classics': '/brand/egg-coffee.jpg',
  "Barista's Choice": '/brand/sea-salt-caramel-oat-latte.jpg',
  'Sweet Sips': '/brand/strawberry-cloud-soda.jpg',
  'Matcha Series': '/brand/coconut-series.jpg',
}

function startingPrice(item: MenuCategoryWithItems['items'][number]): string {
  const cheapest = item.prices.reduce(
    (min, price) => (price.priceCentavos < min ? price.priceCentavos : min),
    Number.POSITIVE_INFINITY,
  )
  return Number.isFinite(cheapest) ? formatPesos(cheapest) : ''
}

export function MenuSection({ categories }: { categories: MenuCategoryWithItems[] }) {
  return (
    <section id="menu">
      <div className="container">
        <div className="section-head">
          <h2>Menu highlights</h2>
          <p>
            From classic espresso-based drinks to creamy cloud favorites and
            refreshing fruit-forward picks, there’s something here for every mood.
          </p>
        </div>

        <div className="menu-grid">
          {categories.map((category) => (
            <article className="menu-card" key={category.id}>
              {CATEGORY_IMAGES[category.name] ? (
                <img
                  src={CATEGORY_IMAGES[category.name]}
                  alt={`${category.name} from Kennko`}
                />
              ) : null}
              <div className="menu-card-body">
                <h3>{category.name}</h3>
                <ul className="menu-list">
                  {category.items.map((item) => (
                    <li key={item.id}>
                      {item.name}
                      {item.isBestseller ? ' ★' : ''}
                      <span className="menu-price">{startingPrice(item)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Style the price**

Append to `app/globals.css`:

```css
.menu-list li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.menu-price {
  font-weight: 700;
  color: var(--blue);
  white-space: nowrap;
}
```

- [ ] **Step 3: Load the menu in the page**

Modify `app/page.tsx` — make it async and pass the data down:

```tsx
import { getMenu } from '@/lib/menu/queries'
// ...other imports unchanged

export const revalidate = 60

export default async function HomePage() {
  const categories = await getMenu()

  return (
    <>
      <Nav />
      <main>
        <Hero />
        <About />
        <MenuSection categories={categories} />
        <Perks />
        <Visit />
      </main>
      <Footer />
    </>
  )
}
```

- [ ] **Step 4: Verify in the browser**

Run `npm run dev`. The menu section must show four categories with all 22 drinks and a starting price on each, and must still match the original layout at 375, 768, 1024, and 1440px. Long names with prices are the likeliest overflow — check "Sea Salt Caramel Oat" and "Salty Vanilla Cream" at 375px specifically.

- [ ] **Step 5: Prove it is actually database-driven**

Change one price directly in Supabase, reload after 60s (or restart dev), and confirm the page reflects it. Then change it back. If the page does not update, it is still reading stale build output and `revalidate` is not working.

- [ ] **Step 6: Build and commit**

```bash
npm run build
git add -A
git commit -m "feat: render public menu from Supabase"
```

---

### Task 9: Correct the project documentation

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `brand/BRIEF.md`

`CLAUDE.md` currently says the project is a single self-contained `index.html`, static, with no server-side code. After Task 3 deleted `index.html`, all three statements are false. Spec §16 requires this task; leaving it undone actively misleads the next person or agent to open the repo.

- [ ] **Step 1: Rewrite CLAUDE.md**

Replace the contents of `CLAUDE.md`:

```markdown
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
- `public/brand/` — brand assets served by the app

## Conventions
- Money is stored and passed as **integer centavos**. Format only at render,
  via `formatPesos()` in `lib/money.ts`.
- Use `type`, never `interface`.
- Mobile, tablet, and desktop are all required. Breakpoints: 920px and 640px.
  Verify at 375, 768, 1024, and 1440px.

## Environment
Copy `.env.local.example` to `.env.local` and fill it in. The service-role key
is required only to run the seeder and must never be committed or exposed to
the browser.

## Commands
- `npm run dev` — local dev server
- `npm test` — unit tests
- `npm run build` — production build
- `npm run seed` — seed the menu from `supabase/seed/menu.ts`

## Deploying
Vercel auto-deploys on push to `main`.
```

- [ ] **Step 2: Correct the stale menu in BRIEF.md**

Spec §12 q9: the brief lists Berry Matcha, Coconut Series, Vanilla Milk Cloud Foam, and Strawberry Cloud Soda, none of which are on the current menu, and its category names are wrong. Replace the `## Menu` section of `brand/BRIEF.md` with the four current categories and 22 drinks from spec Appendix A, and note that live prices are in Supabase rather than duplicated here.

- [ ] **Step 3: Update README.md**

Replace the setup section with: clone, `npm install`, copy `.env.local.example`, `npx supabase db push`, `npm run seed`, `npm run dev`.

- [ ] **Step 4: Verify nothing still claims the site is static**

```bash
grep -ril "single index.html\|no server-side\|self-contained" CLAUDE.md README.md \
  && echo "FAIL: stale claim" || echo "OK"
```

Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: update project docs for the Next.js + Supabase structure"
```

---

## Definition of Done

- [ ] `npm test` passes.
- [ ] `npm run build` succeeds.
- [ ] The deployed page is visually indistinguishable from the pre-port site at 375, 768, 1024, and 1440px, except for the added prices.
- [ ] The menu section renders 4 categories and 22 drinks from Supabase.
- [ ] An anon-key write to `menu_categories` is rejected by RLS.
- [ ] No file in the repo says the project is a static single-file site.
- [ ] No file in the repo says "SM Butuan".

---

## Subsequent plans

This plan deliberately stops at a data-driven marketing site. Two plans follow, each written after its predecessor ships:

**Plan 2 — Admin** (`docs/superpowers/plans/…-kennko-admin.md`)
Supabase Auth with `staff` roles, middleware-guarded `/admin`, the `owner`/`barista` RLS policies, menu CRUD, product image upload to the public `menu-images` bucket, and staff management. Deliverable: the owner manages the menu without a developer.

**Plan 3 — Ordering** (`docs/superpowers/plans/…-kennko-ordering.md`)
`/order` browse and cart with size and modifier selection, checkout, the placeholder GCash QR, reference and screenshot upload to the private `payment-proofs` bucket, order creation with server-side total recomputation, Resend emails, and the admin verification queue with duplicate-reference detection. Ships behind a feature flag; enabling it publicly requires the real GCash QR.
