---
name: kennko-deploy
description: Deploy Kennko Coffee web, API, POS tablet, and Wall projector apps (both on-site via ADB and remotely via OTA + GitHub Actions CI/CD). Use whenever Julius asks to deploy, release, build APKs, or update the till/wall.
---

# Kennko Deployment Guide

Follow the matching deployment path depending on whether Julius is **on-site at Kennko** or **remote**.

## 1. Web & API (Vercel via GitHub Actions)
- Pushing to `main` automatically triggers [.github/workflows/ci-cd.yml](../../../.github/workflows/ci-cd.yml):
  1. `Test & Typecheck` (`npm ci`, `npm test`, `npm run typecheck`)
  2. `Deploy API (Vercel)` (`kennko-api`)
  3. `Deploy Web (Vercel)` (`kennko`)
- Never commit `.env*` files, keys, or tokens. Ask before committing/pushing if Julius has not requested it.

## 2. On-Site Android Deploy (ADB over shop Wi-Fi)
Use when connected to the Kennko shop network (`adb devices -l` shows `192.168.1.21:5555` for Wall and/or `SM_X210` for POS).

- **Required Java 21:** `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`
- **Clear `android/kennko-kit/build` between POS and Wall builds** to avoid AGP `bundleLibRuntimeToDir` collisions.

```bash
# Build signed release POS APK (always point to production API)
rm -rf android/kennko-kit/build && KENNKO_API_URL=https://kennko-api.vercel.app npm run pos:apk -- --release

# Build signed release Wall APK
rm -rf android/kennko-kit/build && npm run wall:apk -- --release

# Install & relaunch (always force-stop before start)
adb -s <tablet> install -r apps/pos/android/app/build/outputs/apk/release/app-release.apk
adb -s <tablet> shell am force-stop coffee.kennko.pos
adb -s <tablet> shell am start -n coffee.kennko.pos/.MainActivity

adb -s 192.168.1.21:5555 install -r apps/wall-app/android/app/build/outputs/apk/release/app-release.apk
adb -s 192.168.1.21:5555 shell am force-stop coffee.kennko.wall
adb -s 192.168.1.21:5555 shell am start -n coffee.kennko.wall/.MainActivity
```

## 3. Remote Android OTA Deploy (From Another City)
Both apps include `UpdatePlugin.kt`, which polls `https://kennko.vercel.app/apps/updates.json` and installs newer signed APKs (`versionCode > installed`).

Use [scripts/deploy-remote.mjs](../../../scripts/deploy-remote.mjs):
```bash
node scripts/deploy-remote.mjs <wall|pos|both> --notes "Short release note"
```
What it does:
1. Runs `npm test` and `npm run typecheck` (skip with `--skip-tests` only if just run).
2. Bumps patch `"version"` in `apps/pos/package.json` and/or `apps/wall-app/package.json` (`--no-bump` if already bumped) and commits.
3. Pushes `main`, sets `ENABLE_ANDROID_RELEASE=true`, and triggers `.github/workflows/android-release.yml`.
4. GitHub Actions builds signed release APK(s), attaches them to a GitHub Release, updates `apps/web/public/apps/updates.json`, and pushes `main` so Vercel publishes the OTA update.

## 4. Scene Sync Rule
Whenever editing `wall/public/scene/{logic,scene}.mjs` or `packages/cats/src/pixel-cats.js`:
- Run `npm run export-wall -w @kennko/cats` if `pixel-cats.js` changed (keeps `wall/public/scene/cats.mjs` byte-identical).
- Sync `wall/public/scene/*.mjs` to `apps/web/lib/cafe/scene/` so `/cafe` matches the projector wall.
- Bump `CACHE` in `wall/public/sw.js` when `wall/public/*` assets change.
