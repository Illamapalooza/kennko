# Kennko Coffee — Repo Instructions

npm workspaces monorepo for Kennko Coffee (Butuan City). `README.md` has the full map of apps and packages with
their commands.

This file is the one rulebook for every coding agent (Claude Code, Antigravity, Codex). `CLAUDE.md` only imports
it and `GEMINI.md` is a symlink to it. **Edit rules here, nowhere else.**

- `apps/web` — Next.js website, online ordering, admin. Read `apps/web/CLAUDE.md` before working there.
- `apps/api` — backend API (Hono on Vercel) and the Supabase migrations. Read `apps/api/README.md`.
- `apps/pos` — the shop till (React + a small Node server + local SQLite, plus the Capacitor Android app). Read `apps/pos/README.md`.
- `apps/wall-app` — Capacitor Android shell for the projector wall. See `apps/wall-app/PROBE.md`.
- `android/kennko-kit` — shared Android/Capacitor plugin library (`SqlitePlugin`, `KioskPlugin`, `FeedPlugin`, `FindPlugin`, `UpdatePlugin`, signing/versioning).
- `wall` — cat cafe scene for the projector (plain Node, no dependencies, imports nothing from the apps). With
  `--pos` it follows the till over HTTP (`/api/wall/events`). Read `wall/README.md`.
- `packages/core` — shared money, menu, ice, cart and order rules. Anything both the website and the till must agree on
  goes here, not in an app.
- `packages/tokens` — design tokens shared by every app. See `brand/DESIGN.md`.

## Conventions
- Money is **integer centavos** everywhere. Format only at render with `formatPesos()` from `@kennko/core`.
- Use `type`, never `interface`.
- Brand: electric blue `#0055FF`, white, amber accent, no dark themes. See `brand/BRIEF.md`.
- New apps go under `apps/`. No Turborepo or Nx until builds or task running actually need it.
- Run `npm test` and `npm run typecheck` from the repo root before committing.

## Android build & device workflow
- **Java 21 for Gradle:** Capacitor 8 requires JDK 21: `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`.
- **Build debug APKs** (clear `android/kennko-kit/build` when switching between apps to avoid AGP `bundleLibRuntimeToDirDebug` collisions):
  ```bash
  rm -rf android/kennko-kit/build && npm run pos:apk
  rm -rf android/kennko-kit/build && npm run wall:apk
  ```
  For release APKs, pass `-- --release` (requires `~/.kennko/keystore.properties`; see `docs/android-release.md`).
- **Shop devices & ADB:**
  - `adb devices -l` to list attached devices.
  - **Samsung tablet (`SM_X210`, `coffee.kennko.pos`, static IP `192.168.1.50`):** Wireless Debugging (`adb connect 192.168.1.50:<port>`, pair once with `adb pair 192.168.1.50:<pair-port>`).
  - **Wanbo WPD24 projector (`TV_Stick`, `coffee.kennko.wall`, static IP `192.168.1.51`):** `adb connect 192.168.1.51:5555`.
  - **Router (`HG8145X6-10`):** AP/client isolation must remain off so NSD (`_kennko-pos._tcp.`) and ADB work across Mac, tablet, and projector.
- **Reinstall & launch:**
  ```bash
  adb -s <tablet> install -r apps/pos/android/app/build/outputs/apk/debug/app-debug.apk
  adb -s <tablet> shell am start -n coffee.kennko.pos/.MainActivity

  adb -s <projector> install -r apps/wall-app/android/app/build/outputs/apk/debug/app-debug.apk
  adb -s <projector> shell am start -n coffee.kennko.wall/.MainActivity
  ```
  If POS/API changes were made, remember the tablet talks to production Vercel (`main`), so push `main` when asked to deploy API updates.

## Safety
- **This repo is public on GitHub.** Never commit `.env*` files, keys, tokens or customer data.
- **Pushing to `main` deploys the website** (Vercel). Commit or push only when Julius asks.
- Never run migrations or any command against the real Supabase project or Vercel unless Julius asks for that
  exact action. Database tests run on PGlite.
- Check the branch before any repo change (`git branch --show-current && git status`). Other sessions work in
  this checkout and may switch branches or commit while you work. Commit only the files of your own task.

## Plans and progress
- Specs: `docs/superpowers/specs/`. Implementation plans: `docs/superpowers/plans/`. Both are committed.
- Progress on a plan being executed: `.superpowers/sdd/<plan-name>/progress.md` (local, not committed).
- `.superpowers/sdd/process-rules.md`, when present, holds the rules for implementers on the current series of
  plans. Read it before executing a task from one of them.
- `docs/HANDOVER-pos.md` is the background on the till and the wall: what Julius decided and why.

## Switching between coding agents
Julius works on this repo from more than one agent. They share only the files on disk: not the conversation,
not memory, not the skill that was running.

- **Starting a session:** if `.agents/HANDOFF.md` exists, read it before anything else, then the plan and the
  progress file it names. Check that the branch and commit it records match `git branch --show-current` and
  `git rev-parse --short HEAD`. If they do not, say so before continuing.
- **Stopping mid-task, or when Julius says he is switching tools:** write `.agents/HANDOFF.md` with the
  `handoff` skill (`/handoff`). Without the skill, write the same things by hand: branch and commit, the plan
  path, what is done, what is half-done, the exact next step, decisions made in conversation that are not in
  the plan, the process being followed (tests, reviews, commit rules), and how to verify.
- **When the handed-off work is finished:** delete the file.
- `.agents/HANDOFF.md` is local working state. It is ignored by git and must never be committed, and it must
  never contain a secret.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
