# Kennko Coffee

Everything Kennko Coffee runs on, in one repo. CT. Montalban St., Villa Kananga, Butuan City.

| Where | What | Start it |
|---|---|---|
| `apps/web` | Website, online ordering and admin (Next.js on Vercel, Supabase) | `npm run dev` |
| `apps/pos` | The till for the shop tablets, with a local sales database | `npm run pos` |
| `wall` | Cat cafe scene for the shop projector | `npm run wall` |
| `packages/core` | Prices, discounts, ice and order rules shared by the website and the till | |

## Setup

```bash
npm install                                        # once, from the repo root
cp apps/web/.env.local.example apps/web/.env.local # fill in the Supabase credentials
```

Website database and seeding commands run from `apps/web`; see `apps/web/CLAUDE.md`. The till is covered in
`apps/pos/README.md`, the wall in `wall/README.md`.

## Commands (repo root)

| Command | Does |
|---|---|
| `npm run dev` / `npm run build` | Website dev server on :3000 / production build |
| `npm run pos` | Till in development on :4466 |
| `npm run pos:build`, then `npm run pos:start` | Till as it runs in the shop |
| `npm run wall` | Wall on :4455 |
| `npm test` | Every test suite |
| `npm run typecheck` | Typecheck the website and the till |

This is a plain npm workspaces monorepo. Turborepo or Nx can be added later if builds get slow; nothing needs them yet.

## Docs

- `docs/superpowers/specs/` and `docs/superpowers/plans/` hold design specs and implementation plans
- `brand/BRIEF.md` holds brand guidelines, palette and copy tone
