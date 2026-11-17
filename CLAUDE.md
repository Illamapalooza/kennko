# Kennko Coffee — Repo Instructions

npm workspaces monorepo for Kennko Coffee (Butuan City).

- `apps/web` — Next.js website, online ordering, admin. Read `apps/web/CLAUDE.md` before working there.
- `apps/pos` — the shop till (React + a small Node server + local SQLite). Read `apps/pos/README.md`.
- `wall` — standalone cat cafe scene for the projector (plain Node, no dependencies). Read `wall/README.md`.
- `packages/core` — shared money, menu, ice, cart and order rules. Anything both the website and the till must agree on
  goes here, not in an app.

## Conventions
- Money is **integer centavos** everywhere. Format only at render with `formatPesos()` from `@kennko/core`.
- Use `type`, never `interface`.
- Brand: electric blue `#0055FF`, white, amber accent, no dark themes. See `brand/BRIEF.md`.
- New apps go under `apps/`. No Turborepo or Nx until builds or task running actually need it.
- Run `npm test` and `npm run typecheck` from the repo root before committing.
