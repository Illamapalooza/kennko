# Kennko Coffee

Everything Kennko Coffee runs on, in one repo. CT. Montalban St., Villa Kananga, Butuan City.

| Where | What | Start it |
|---|---|---|
| `apps/web` | Website: landing page, online ordering (`/order`) and admin (`/admin`). Next.js on Vercel, Supabase | `npm run dev` |
| `apps/pos` | The till for the shop tablets, with a local sales database | `npm run pos` |
| `wall` | Cat cafe scene for the shop projector, with its own order pad | `npm run wall` |
| `packages/core` | Prices, discounts, ice and order rules shared by the website and the till | |
| `packages/tokens` | Design tokens (colours, type, spacing) shared by every app; see `brand/DESIGN.md` | |

**Three apps** (the website, the till and the wall) and **two shared packages** (`core` and `tokens`). The landing
page, online ordering and admin are one app, `apps/web`, on different routes.

## Setup

```bash
npm install                                        # once, from the repo root
cp apps/web/.env.local.example apps/web/.env.local # fill in the Supabase credentials
```

Website database and seeding commands run from `apps/web`; see `apps/web/CLAUDE.md`. The till is covered in
`apps/pos/README.md`, the wall in `wall/README.md`.

**Putting it in the shop:** the till and the wall run on the shop's Windows tablet, the wall shows on the projector.
Step-by-step in `deploy/windows/README.md` (one double-click setup).

## Run everything at once

```bash
npm run all            # website and till together
npm run all -- --wall  # the same, plus the wall following the till
```

| App | Address |
|---|---|
| Landing page | http://localhost:3000 |
| Online ordering | http://localhost:3000/order (needs `NEXT_PUBLIC_ORDERING_ENABLED=true` in `apps/web/.env.local`) |
| Admin | http://localhost:3000/admin |
| Till (POS) | http://localhost:4466 |
| Wall (with `--wall`) | http://localhost:4455 |

Each app's output is labelled `[web ]`, `[pos ]` or `[wall]`. Ctrl+C stops all of them, and if one crashes the others
stop too. This is for development. In the shop, the till and the wall start through `deploy/windows/README.md`.

## Commands (repo root)

| Command | Does |
|---|---|
| `npm run all` | Website and till together (`-- --wall` adds the wall) |
| `npm run dev` / `npm run build` | Website dev server on :3000 / production build |
| `npm run pos` | Till in development on :4466 |
| `npm run pos:build`, then `npm run pos:start` | Till as it runs in the shop |
| `npm run wall` | Wall on :4455, running by itself |
| `npm run wall:pos` | Wall following the till: real orders, queue and ready calls |
| `npm test` | Every test suite |
| `npm run typecheck` | Typecheck the website and the till |

This is a plain npm workspaces monorepo. Turborepo or Nx can be added later if builds get slow; nothing needs them yet.

## Docs

- `docs/superpowers/specs/` and `docs/superpowers/plans/` hold design specs and implementation plans
- `brand/BRIEF.md` holds brand guidelines, palette and copy tone
