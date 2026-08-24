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
- `public/brand/` — brand assets served by the app (lowercase kebab-case names)

## Conventions
- Money is stored and passed as **integer centavos**. Format only at render,
  via `formatPesos()` in `lib/money.ts`.
- Use `type`, never `interface`.
- Mobile, tablet, and desktop are all required. Breakpoints: 920px and 640px.
  Verify at 375, 768, 1024, and 1440px.
- The cafe is at **CT. Montalban St., Villa Kananga, Butuan City** — it moved
  out of SM Butuan. No file should say "SM Butuan".

## Environment
Copy `.env.local.example` to `.env.local` and fill it in. The app will not build
without `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The
service-role key is needed only to run the seeder, and must never be committed
or exposed to the browser.

## Commands
- `npm run dev` — local dev server
- `npm test` — unit tests
- `npm run build` — production build
- `npm run seed` — seed the menu from `supabase/seed/menu.ts`

## Planned Work
`docs/superpowers/specs/` holds the ordering + admin design spec.
`docs/superpowers/plans/` holds the implementation plans. Plan 1 (this
foundation) is done; Plans 2 (admin) and 3 (ordering) are not yet written.

## Deploying
Vercel auto-deploys on push to `main`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
