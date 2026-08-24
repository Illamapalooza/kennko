# Kennko Coffee

Marketing site for Kennko Coffee — CT. Montalban St., Villa Kananga, Butuan City.

Next.js (App Router, TypeScript) on Vercel, with menu data in Supabase Postgres.

## Setup

```bash
npm install
cp .env.local.example .env.local   # fill in your Supabase credentials
npx supabase db push               # apply the schema
npm run seed                       # load the menu (needs the service-role key)
npm run create-owner -- you@example.com '<password>' "Your Name"
npm run dev
```

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Local dev server on :3000 |
| `npm test` | Unit and component tests |
| `npm run build` | Production build |
| `npm run seed` | Seed the menu from `supabase/seed/menu.ts` |
| `npm run create-owner` | Create the first admin owner account |

## Docs

- `docs/superpowers/specs/` — design spec for online ordering and admin
- `docs/superpowers/plans/` — implementation plans
- `brand/BRIEF.md` — brand guidelines, palette, and copy tone
