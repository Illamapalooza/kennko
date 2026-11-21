# Kennko POS and Kennko Wall as Android apps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The till runs as **Kennko POS**, a sideloaded Android app on the Samsung tablet that sells with no internet. The wall runs as **Kennko Wall**, a sideloaded Android TV app on the Wanbo WPD24 that finds the tablet on the shop wifi by itself. Both update in place with a tap.

**Architecture:**
- **One till core, two hosts.** The platform-free logic in `apps/pos/server` (store, outbox, sync, pairing, PINs, sessions, check-in, wall feed, menu, reports) moves to `apps/pos/till/`, together with a request router (`createTill`) lifted out of today's `server/index.ts`. The core imports nothing from `node:*`. It reaches the platform only through a small `TillHost`: a **synchronous** SQL handle, a small file store, `fetch`, a config and a backup hook.
  - The **Node host** (`apps/pos/server/index.ts`) is the current till, now a thin HTTP shell. It keeps working on the Mac.
  - The **Android host** (`apps/pos/src/app/`) runs the same core inside the Capacitor WebView. The screens' `api.*` calls go through an in-process transport instead of `fetch`.
- **Storage stays synchronous.** On Android, SQLite is native: `androidx.sqlite` bundled SQLite in app-private storage, exposed to the page through a synchronous `@JavascriptInterface`. So `store.ts` and its transactions are unchanged.
- **Native pieces live in one Kotlin library**, `android/kennko-kit`, which both apps include:
  - the SQLite bridge;
  - the wifi wall-feed server and its network announcement (NSD);
  - finding the till on the wifi;
  - the update check and installer;
  - the kiosk helpers (screen on, full screen, battery).
- **The wall app** packages `wall/public`. In-page code finds the till over NSD and follows its `/api/wall/events` feed with the same parsing the Node wall uses. Sound effects made with Web Audio replace the music.

**Tech Stack:** Capacitor 8 (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli`, `@capacitor/app`, `@capacitor/filesystem`, `@capacitor/share`; exact versions pinned at install), Kotlin, Gradle wrapper, `androidx.sqlite:sqlite-bundled` (2.5 or newer), JUnit 4 (JVM unit tests). React 19 + Vite 8 (screens), vitest 4. `@noble/hashes` (sync SHA-256/SHA-1, scrypt) in `packages/core`. Node 24 (`node:sqlite`) for the Node till. Plain JS with `node --test` for the wall.

**Spec:** `docs/superpowers/specs/2026-11-21-kennko-android-apps-design.md` (approved 2026-11-22). Every item under "Decided by Julius" and "Builder's calls" is binding. The rulings below settle "Left to the builder".

**Build machine:** Julius's Mac, with Android Studio, `ANDROID_HOME=/Users/juliusbaliling/Library/Android/sdk` (platform-tools, build-tools 34/35, NDK, platforms 34/35) and OpenJDK 17. There is no global Gradle, so every Gradle command is `./gradlew` inside a Capacitor `android/` folder.

## Global Constraints

- Money is integer centavos everywhere; format only at render with `formatPesos()`. Use `type`, never `interface`. Brand: `#0055FF`, white, amber `#FFB830`, no dark themes.
- Logic both the website and the till need lives in `packages/core`. Logic both the Node till and the app need lives in `apps/pos/till`, which must not import `node:*` (a test enforces it).
- **The sync contract is unchanged:** the same `/v1/devices/*` and `/v1/sync/*` calls, the same outbox order, clock skew from the `Date` header, and the pull's check-in secret and visitors. No change to `apps/api`, `apps/web` behaviour, or admin.
- **The Node till and Node wall keep working.** Their tests stay green after every task, and `npm test` and `npm run typecheck` at the root pass after every task.
- **The check-in secret never leaves the till core.** It is not in the wall feed, any `api.*` answer, a log or a backup. **The device token** lives in the database on Android (never a loose file) and is stripped from every backup copy.
- **Staff never see settings, addresses, IPs or a browser.** The wall's manual address is behind the hidden settings screen only.
- **No Firebase, no push into the POS app, no printing, no import from the old POS, no music on the wall.** One till tablet.
- **Signing:** one release key for both apps, outside the repo (`~/.kennko/`). Never commit a keystore, password, `keystore.properties` or an APK. `versionCode` strictly increases on every release.
- Imports carry their extension (`.ts`/`.tsx` in `apps/pos`, `.mjs` in `wall`). Kotlin package roots: `coffee.kennko.kit`, `coffee.kennko.pos`, `coffee.kennko.wall`.
- **Never stage** `.DS_Store`, `brand/.DS_Store` or `deploy/windows/README.md` (Julius's uncommitted edits). Stage files by name, never `git add -A`.
- Each task header says how it is verified: **[none]** (tests only), **[emulator]**, **[Samsung]** or **[projector]**. Device-only checks are listed as manual steps for Julius. The task is reviewed on its automated steps, and the device steps are recorded in the task's commit notes or in the release checklist.

## Rulings (Claude's calls, within "Left to the builder")

1. **The SQL adapter is synchronous; the store does not move to async.** `till/sql.ts` defines `SqlDb`, which `node:sqlite`'s `DatabaseSync` already satisfies. On Android, a native bridge satisfies it.
   - *Why:* `store.ts` (972 lines), `legacy-import.ts` and `sessions.ts` rely on synchronous `begin immediate … commit` with nothing interleaving. Going async would rewrite all of them and every test, and would open interleaving inside transactions in a cash register.
   - *Rejected:* `@capacitor-community/sqlite` (async bridge), and sqlite-wasm on OPFS (WebView storage can be evicted, and the data would sit outside a plain app-private database file).
2. **Android SQLite is `androidx.sqlite:sqlite-bundled` behind a synchronous `@JavascriptInterface` named `KennkoSqlite`**, registered in a Capacitor plugin's `load()`, which runs before the page loads.
   - *Why:* typed binds (the framework's `rawQuery` binds everything as text), the same modern SQLite on every Android version (`vacuum into`, upserts), and it runs on the JVM for unit tests on the Mac.
   - The page loads only the app's bundled files, and navigation to other origins is off, so the interface is not exposed to remote content.
3. **API calls from the app use native HTTP through an injected `fetch` (`nativeFetch`) built on `CapacitorHttp.request`, not the global fetch patch.**
   - *Why:* `apps/api` sends no CORS headers, and the spec forbids API changes. The core already takes `fetchFn` everywhere. The adapter keeps the `Date` header (clock skew), the status, the JSON body and `AbortSignal` timeouts.
   - `CapacitorHttp.enabled` stays `false`.
4. **Portable crypto in core:** `@noble/hashes` gives synchronous SHA-256 and SHA-1 (session token hashes, shared-PIN compare, `uuid5`) and `scryptAsync` (`checkStaffPin` in the WebView). `crypto.randomUUID` and `crypto.getRandomValues` come from the global `crypto` in both hosts.
   - *Why:* `node:crypto` is not in the WebView, and Web Crypto has no scrypt and only async digests, while sessions are synchronous.
5. **Files become a `TillFiles` store.** The Node host keeps the same files in `data/` (`device.json` with mode 0600, `menu-snapshot.json`, `menu.json`), so the Mac till needs no migration. The Android host keeps them as `kv` rows `file:<name>` in the same database. `store.snapshot()` deletes `file:%` rows from every copy.
6. **The app's first run is "Connect this till" with no PIN, then per-person PINs only.** `TillConfig.firstRun = 'connect'` means:
   - every route except `GET /api/bootstrap`, `GET /api/session` and `POST /api/device/pair` answers 409 until the till is paired;
   - pairing needs no manager PIN while there has never been a device;
   - the PIN directory is per-person only (no shared or off mode). With no owner or manager PIN in the staff list, the gate says so.

   Revoked in admin means the till keeps selling with the cached PINs, as today. Forgetting the connection returns the app to the Connect screen.
7. **The wall feed server is hand-rolled Kotlin** (`ServerSocket`, GET only: `/api/wall/events` as SSE and `/api/wall/menu`, plus a 404) on **port 4466**, with `Access-Control-Allow-Origin: *`.
   - It sends the latest frame on connect, then frames as the core publishes them, with a `: keepalive` comment every 20 s.
   - The core keeps its 20 s frame re-send and the server-minute frame, so watchdogs see data at least every 20 s.
   - The server starts in the activity's `onStart` and stops in `onStop` (a dialog or the share sheet does not stop it; the screen going off does).
   - *Why:* two read-only routes do not justify NanoHTTPD's awkward SSE support or a dependency.
8. **Network announcement:** NSD service type `_kennko-pos._tcp.`, name `Kennko POS`, port 4466, TXT `v=1`. The wall resolves the first `Kennko POS` service and remembers its last address. If it finds nothing, it tries the remembered address and then the manual address from hidden settings.
9. **The wall app is a new workspace, `apps/wall-app`.** It copies `wall/public` (minus `pad.*`, `sw.js` and the manifests) into `www/` at build time, so `wall/` stays zero-dependency. App-only page code lives in `wall/public/app/` and loads only when `window.Capacitor?.isNativePlatform()` is true.
   - The wall app uses `androidScheme: 'http'` with cleartext allowed for private addresses, so the page can open `http://<tablet>:4466` without mixed-content blocking.
10. **Music is dropped from the shared wall page** (the Node wall too: `/api/playlist`, `music/`, the `N` key). Sound effects replace it in both. *Why:* one page, one behaviour, and the spec's non-goal. `M` still mutes on the Node wall.
11. **Hidden settings on the wall:** hold the remote's OK for 3 seconds, or press its Menu key. The screen offers:
    - **Till address** (manual fallback);
    - **Sound effects on/off**;
    - **Look for the till again**;
    - **Check for update**;
    - the version.

    Settings are kept in `localStorage` (they are conveniences, and the last-found address is re-discovered anyway).
12. **Updates:**
    - The JSON lives at `https://kennko.vercel.app/apps/updates.json` (`apps/web/public/apps/updates.json`, deployed with the website).
    - The shape is `{ "pos": UpdateEntry, "wall": UpdateEntry }`, where `UpdateEntry = { versionCode: number; versionName: string; url: string; notes: string }`.
    - APKs are hosted in **Supabase Storage**, in a public bucket `apps` under a random 32-hex folder (`apps/<folder>/kennko-pos-1.0.3.apk`).
      - Supabase is an existing service with no new cost.
      - Files download with no login, and anon users have no list policy, so the URL is unlisted.
      - The files are not in git.
    - The check and the install are native, in the kit (`KennkoUpdate`). The install uses a `PackageInstaller` session.
    - Android refuses an APK not signed with the Kennko key as an update, so no extra hash is needed.
13. **Versions:** `versionName` is the workspace `package.json` `version` (`apps/pos`, `apps/wall-app`). `versionCode = major*10000 + minor*100 + patch`, computed in Gradle from that file. `scripts/release-apk.mjs` refuses to publish a `versionCode` not greater than the one in `updates.json`.
14. **Release API address:** `scripts/build-pos-app.mjs` reads `KENNKO_API_URL` from the environment (Julius's shell already sets it for the Mac till) into `VITE_KENNKO_API_URL`. A `--release` build refuses an empty or non-https value. A debug build may point anywhere. Pairing a debug build to production makes a second till, so after go-live, debug builds pair to a non-production API or are disconnected straight after a test.
15. **New-online-order alerts are computed in the screens** (`src/onlineAlerts.ts`), from the live feed's `online` list.
    - Seen ids are kept in `localStorage`. With no memory (the first load after connecting, or after Connect) the current list is the baseline and nothing chimes.
    - The amber badge on Orders counts unseen new orders until Orders is opened, and is shown in place of the active count while it is above zero.
    - The banner reads `New online order W3`, or `3 new online orders`. It stays until it is tapped (which opens Orders) or Orders is opened.
    - The Node till's screens get this too (harmless, the same code).
16. **App ids and names:** `coffee.kennko.pos` "Kennko POS" (landscape, screen kept on) and `coffee.kennko.wall` "Kennko Wall" (Android TV leanback launcher, landscape, full screen, screen kept on). Signing files: `~/.kennko/kennko-release.jks` and `~/.kennko/keystore.properties`.
17. **The projector probe is a throwaway Capacitor build of `apps/wall-app`** (`www-probe/`). It runs the **real** scene modules plus a feature report, NSD discovery of a stub announced by the Mac, an SSE connection to that stub, a Web Audio beep and a boot receiver.
    - **Pass:** the scene animates for 60 s with no uncaught error, discovery finds the stub, the SSE frames arrive, the beep is heard, and the report shows `WebView ≥ 90`.
    - Anything else means updating "Android System WebView" through Play on the projector and probing again. A second fail means branch B (Task 12B).

## Review Focus

1. **An update or restart never loses unsynced sales.** Install vN+1 over vN with outbox rows pending: the rows are still there and sync resumes. Pinned by the `adb install -r` emulator step in Task 9 and the release checklist (Task 14).
2. **The tablet sleeping or backgrounding mid-shift.** On resume the till syncs at once, makes a fresh check-in frame and restarts the feed. While the feed is down the wall clears the QR and keeps the orders. Pinned by `lifecycle.test.ts` (Task 9) and `follow.test.mjs` (Task 11).
3. **The wall cannot find the tablet** (no NSD answer, the tablet's IP changed, the tablet asleep). It says so in plain words, keeps looking, tries the last and manual addresses, and never blanks the board. Pinned by `finder.test.mjs` (Task 12A).
4. **First run goes wrong:** no internet, a mistyped or expired code, or the owner has issued no PINs yet. Each shows plain copy and selling stays impossible until connected. Pinned by the `till-router.test.ts` first-run cases (Task 4) and the `Gate` copy test (Task 5).
5. **Native bridge fidelity:** millisecond timestamps (larger than 2^31), `null`, `Ñ` and emoji, `lastInsertRowid` and `changes`, and SQLite errors keeping their text (`UNIQUE constraint failed`) so the store's refusals behave the same. Pinned by `runSqlContract` in vitest (Task 3), the JVM `SqliteBridgeTest` (Task 7) and the on-device self-test (Task 8).

---

### Task 1: Projector probe APK and the wall-app workspace  **[projector]**

**Files:**
- Create: `apps/wall-app/package.json` (`@kennko/wall-app`, version `0.0.1`, scripts `probe:build`, `probe:apk`), `apps/wall-app/capacitor.config.ts`, `apps/wall-app/android/` (via `npx cap add android`), `apps/wall-app/www-probe/index.html`, `apps/wall-app/www-probe/probe.mjs`, `apps/wall-app/probe/feed-stub.mjs`, `apps/wall-app/probe/copy-scene.mjs`, `apps/wall-app/android/app/src/main/java/coffee/kennko/wall/ProbePlugin.kt`, `apps/wall-app/android/app/src/main/java/coffee/kennko/wall/BootReceiver.kt`, `apps/wall-app/PROBE.md`
- Modify: `.gitignore` (`/apps/wall-app/www/`, `/apps/wall-app/www-probe/scene/`, `*.apk`, `*.aab`, `*.jks`, `*.keystore`, `keystore.properties`, `/apps/*/android/app/release/`), `package-lock.json`

**Interfaces:**
- Produces: the `apps/wall-app` workspace and its Capacitor Android project (`appId: 'coffee.kennko.wall'`, `appName: 'Kennko Wall'`, `server.androidScheme: 'http'`). Task 12A reuses them in branch A; branch B (12B) replaces the Android project.
- `ProbePlugin` (JS name `KennkoProbe`):
  - `info() → { android: string; sdk: number; webViewPackage: string; webViewVersion: string; model: string }`;
  - `discover({ type: '_kennko-pos._tcp.' }) → { host: string; port: number } | { error: string }` (10 s timeout).
- `feed-stub.mjs`: `node apps/wall-app/probe/feed-stub.mjs` announces `Kennko POS` with `dns-sd -R "Kennko POS" _kennko-pos._tcp local 4466` and serves `/api/wall/events`. Each frame is a valid wall feed (two orders, one visitor, a checkin with 21×21 modules), sent every 2 s, with `Access-Control-Allow-Origin: *`.

- [ ] **Step 1: Prepare the SDK and emulators.** Use `sdkmanager --install` to install the platform and build-tools that Capacitor 8's template names in `android/variables.gradle` (`compileSdkVersion`), plus `system-images;android-35;google_apis;arm64-v8a` and `system-images;android-34;android-tv;arm64-v8a`. Create the AVDs `kennko-tablet` (Pixel Tablet) and `kennko-tv` (Android TV 1080p) with `avdmanager`.
  Expected: `emulator -list-avds` prints both.
- [ ] **Step 2: Scaffold the workspace.** Pin exact Capacitor 8 versions. Run `npx cap add android`, set `webDir: 'www-probe'`, and give the manifest the leanback launcher intent, `android.software.leanback` and `android.hardware.touchscreen` both `required="false"`, a 320×180 `banner` drawable from `brand/` assets, `screenOrientation="landscape"`, `RECEIVE_BOOT_COMPLETED` and `usesCleartextTraffic="true"`.
- [ ] **Step 3: The probe page.** `copy-scene.mjs` copies `wall/public/scene/*.mjs`, `wall/public/wall.css` and `wall/public/brand/` into `www-probe/scene/` (gitignored). `probe.mjs` then:
  - imports `./scene/scene.mjs` and runs `createScene` on a canvas with two made-up orders advancing every 5 s;
  - counts frames and records `error` and `unhandledrejection` events;
  - prints `KennkoProbe.info()` and a feature table (`EventSource`, ES modules, `?.`/`??`, `Array.prototype.at`, `structuredClone`, `AudioContext`, `Intl.DateTimeFormat` with `Asia/Manila`);
  - on the remote's OK, plays a 440 Hz beep through Web Audio;
  - calls `discover`, then opens `new EventSource('http://<host>:<port>/api/wall/events')` and shows the frame count;
  - after 60 s shows **PASS** or **FAIL** and the list of reasons, in large type readable across the room.
- [ ] **Step 4: Boot receiver.** `BootReceiver` starts `MainActivity` on `BOOT_COMPLETED`. If that start is blocked, the probe page shows whether "Display over other apps" is granted (`Settings.canDrawOverlays`), with a button that opens that setting.
- [ ] **Step 5: Build and check on the TV emulator.**
  Run: `npm run probe:apk -w @kennko/wall-app` (runs `copy-scene`, `npx cap sync android`, `cd android && ./gradlew assembleDebug`), then `adb -s emulator-5554 install -r android/app/build/outputs/apk/debug/app-debug.apk`.
  Expected: the probe opens from the TV launcher row and the scene animates. Discovery fails on the emulator (its NAT blocks it); that is expected and listed as a reason.
- [ ] **Step 6: Manual (Julius, at the shop).**
  1. On the Mac, on the shop wifi, run `node apps/wall-app/probe/feed-stub.mjs`.
  2. Sideload the debug APK onto the WPD24 (USB stick and a file manager, or `adb connect <projector-ip>` once developer options are on).
  3. Open Kennko Wall and wait 60 s.
  4. Photograph the result screen.
  5. Reboot the projector and note whether the probe opens by itself.
- [ ] **Step 7: Record the decision in `apps/wall-app/PROBE.md`**: Android version, WebView version, PASS/FAIL reasons, and boot-start behaviour, ending with one line, `Wall engine: system WebView (branch A)` or `Wall engine: GeckoView (branch B)`.
  - On a FAIL caused by the WebView version, Julius updates "Android System WebView" in Play on the projector and probes again first.
  - **Task 12A or 12B (whichever the line names) does not start until this line exists.** Tasks 2–11 do not depend on it.
- [ ] **Step 8: Commit**

```bash
git add apps/wall-app .gitignore package.json package-lock.json
git commit -m "feat(wall-app): projector probe APK and the wall-app workspace"
```

---

### Task 2: Portable crypto in core  **[none]**

**Files:**
- Create: `packages/core/src/portable-crypto.ts`, `packages/core/src/staff-pin-check.ts`, `packages/core/src/portable-crypto.test.ts`
- Modify: `packages/core/src/staff-pin.ts` (re-export `checkStaffPin` and `isStaffPin` from `staff-pin-check.ts`; keep `hashStaffPin` and `randomStaffPin` on `node:crypto`), `packages/core/package.json` (`exports["./staff-pin-check"]`, `exports["./portable-crypto"]`, dependency `@noble/hashes` pinned)

**Interfaces:**
- Produces (`portable-crypto.ts`, no `node:*`):
  - `sha256Hex(text: string): string`;
  - `sha1Bytes(data: Uint8Array): Uint8Array`;
  - `randomHex(bytes: number): string`;
  - `randomUuid(): string`;
  - `sameBytes(a: Uint8Array, b: Uint8Array): boolean` (constant time).
- Produces (`staff-pin-check.ts`): `isStaffPin(pin: unknown): pin is string`; `checkStaffPin(pin: string, stored: string): Promise<boolean>`, with the same format and bounds as today, using `scryptAsync` from `@noble/hashes/scrypt`.

- [ ] **Step 1: Write the failing tests** in `portable-crypto.test.ts`:
  - `sha256Hex('kennko')` equals `createHash('sha256').update('kennko').digest('hex')`;
  - `sha1Bytes` matches `node:crypto` SHA-1 for `new TextEncoder().encode('x')`;
  - `randomHex(16)` matches `/^[0-9a-f]{32}$/`, and two calls differ;
  - `randomUuid()` matches the v4 pattern;
  - `sameBytes` is true for equal arrays and false for a one-byte change or a length change;
  - `checkStaffPin portable accepts a node hash`: `checkStaffPin('482913', await hashStaffPin('482913')) === true` and `'482914'` gives false;
  - `checkStaffPin portable refuses tampered cost`: `scrypt$2097152$8$1$…` gives false.
- [ ] **Step 2: Run, expect FAIL** (`npm test -w @kennko/core`: cannot resolve `./portable-crypto.ts`).
- [ ] **Step 3: Implement both modules.** Point `staff-pin.ts`'s existing `checkStaffPin` export at the portable one, so the API and website keep their import paths.
- [ ] **Step 4: Run, expect PASS.** Then `npm test && npm run typecheck` at the root: PASS.
- [ ] **Step 5: Commit** `feat(core): portable hashes and staff PIN check for the app's WebView`.

---

### Task 3: Till core, part 1 — move to `apps/pos/till`, SQL and file adapters  **[none]**

**Files:**
- Move (with `git mv`) from `apps/pos/server/` to `apps/pos/till/`: `store.ts`, `sync.ts`, `device.ts`, `pins.ts`, `sessions.ts`, `checkin.ts`, `wall-feed.ts`, `tablet-feed.ts`, `menu.ts`, `kennko-api.ts`, `legacy-import.ts`, `report.ts`, `wait.ts`, `uuid5.ts`
- Create: `apps/pos/till/sql.ts`, `apps/pos/till/files.ts`, `apps/pos/till/sql-contract.ts`, `apps/pos/server/node-sqlite.ts`, `apps/pos/server/node-files.ts`, `apps/pos/test/sql-contract.test.ts`, `apps/pos/test/till-portable.test.ts`
- Modify: every moved file (swap `node:*` for `@kennko/core/portable-crypto`, `SqlDb`, `TillFiles`), `apps/pos/server/index.ts` (imports), `apps/pos/server/backup.ts` (unchanged API), every `apps/pos/test/*.test.ts` import path, `apps/pos/tsconfig.json` (`include` adds `till`)

**Interfaces:**
- Produces (`till/sql.ts`):
```ts
export type SqlValue = number | string | null
export type SqlRow = Record<string, SqlValue>
export type SqlRunResult = { changes: number | bigint; lastInsertRowid: number | bigint }
export type SqlStatement = { run(...p: SqlValue[]): SqlRunResult; get(...p: SqlValue[]): SqlRow | undefined; all(...p: SqlValue[]): SqlRow[] }
export type SqlDb = { exec(sql: string): void; prepare(sql: string): SqlStatement; close(): void }
export type SqlOpen = (file: string) => SqlDb
```
- Produces (`till/files.ts`): `export type TillFiles = { read(name: string): string | null; write(name: string, text: string, opts?: { secret?: boolean }): void; remove(name: string): void }`.
- Changed signatures (later tasks rely on them):
  - `createStore(file: string, open: SqlOpen): Store`;
  - `createSessions(db: SqlDb, now: () => number)`;
  - `loadDevice(files: TillFiles)`, `saveDevice(files, d)`, `forgetDevice(files)`, `forgetConnection(store, files)`;
  - `loadSnapshot(files)`, `saveSnapshot(files, s)`, `loadMenu(files, now)`;
  - `createSync({ …, files: TillFiles, … })` replaces `dataDir`;
  - `createPinRefresh({ files, refresh, now? })`;
  - `lookupCustomer(store, files, apiUrl, code, fetchFn?)`, `chargeWithFreeDrink({ …, files, … })`, `deviceCall(files, …)`, `releasePending(store, files, …)`.
- Node adapters: `openNodeSqlite: SqlOpen` (`new DatabaseSync(file)`), and `nodeFiles(dir: string): TillFiles`. `nodeFiles` writes `device.json` with mode `0o600` when `secret` is set, and keeps today's file names and layout.
- `runSqlContract(open: SqlOpen, file: string): string[]` returns failure descriptions (empty on pass). It imports no test framework, so the Android self-test (Task 8) can run it.
- `store.snapshot(to)` also runs `delete from kv where key like 'file:%'` on the copy.

- [ ] **Step 1: Write the failing tests.**
  - `till-portable.test.ts`: every `apps/pos/till/*.ts` has no `from 'node:` and no `process.`.
  - `sql-contract.test.ts`: `expect(runSqlContract(openNodeSqlite, tmpFile)).toEqual([])`.
  - In `store.test.ts`: `snapshot drops file rows` sets `kvSet('file:device.json', '{"token":"t"}')`, snapshots, and expects the copy's `kv` to have no `file:%` row and no `checkin_secret`.
- [ ] **Step 2: Run, expect FAIL** (`npm test -w @kennko/pos`: modules not found).
- [ ] **Step 3: Write `runSqlContract`.** In one fresh database it checks:
  - `exec` of a multi-statement script;
  - an insert with `1732233600123` and the same value read back as a number;
  - `null` round-trips;
  - `'Ñoño ☕🐈'` round-trips;
  - `lastInsertRowid` is 1 and then 2;
  - `changes` is 0 or 1;
  - `get` with no row gives `undefined`;
  - `all` keeps order;
  - `begin immediate` / `rollback` leaves no row;
  - a duplicate primary key throws an error whose message contains `UNIQUE constraint failed`;
  - `pragma journal_mode = wal` answers `wal`;
  - `vacuum into ?` creates a readable copy.
- [ ] **Step 4: Move the files and adapt them.** Swap every `dataDir` parameter for `files`. In `sessions.ts` use `sha256Hex` and `randomHex(32)`. In `pins.ts` use `sameBytes` over SHA-256 for the shared PINs and `checkStaffPin` from `@kennko/core/staff-pin-check`. In `uuid5.ts` use `sha1Bytes`. Replace `randomUUID` with `randomUuid`. The Node host passes `nodeFiles(DATA)` and `openNodeSqlite`. Tests switch `createStore(f)` to `createStore(f, openNodeSqlite)` and their temp `dataDir` to `nodeFiles(dir)`.
- [ ] **Step 5: Run, expect PASS.** `npm test && npm run typecheck`: PASS. `npm run pos` starts, and the Mac till still shows `connected as "Counter till"` (its `data/device.json` is read through `nodeFiles`).
- [ ] **Step 6: Commit** `refactor(pos): till core in apps/pos/till behind SQL and file adapters`.

---

### Task 4: Till core, part 2 — the router (`createTill`) and a thin Node host  **[none]**

**Files:**
- Create: `apps/pos/till/till.ts`, `apps/pos/till/host.ts`, `apps/pos/test/till-router.test.ts`
- Modify: `apps/pos/server/index.ts` (keeps HTTP, cookies, static files, Vite, certificate, `/setup` and the console summary; everything under `/api/` goes to `till.request`), `apps/pos/till/pins.ts` (`perPersonOnly` option)

**Interfaces:**
- Produces (`till/host.ts`):
```ts
export type TillConfig = {
  staffPin: string; managerPin: string
  shop: { name: string; address: string; phone: string; receiptFooter: string }
  discounts: Discount[]; apiUrl: string
  /** 'connect': the app. Nothing works until paired; pairing needs no PIN the first time; per-person PINs only. */
  firstRun: 'pins' | 'connect'
}
export type TillHost = {
  sql: SqlDb; open: SqlOpen; files: TillFiles; fetch: typeof fetch; config: TillConfig; baseMenu: Menu
  host: 'node' | 'android'
  /** Copies the database somewhere safe; never throws; returns a line for logs. Called hourly, on start and on closing the till. */
  backup: (snapshot: (file: string) => void) => string
  now?: () => number
  timers?: { set: typeof setTimeout; clear: typeof clearTimeout }
  log?: (line: string) => void
}
export type TillRequest = { method: 'GET' | 'POST'; path: string; body?: unknown; session?: string; client: string; secureUrl?: string | null }
export type TillResponse = { status: number; body: unknown; session?: string | null; csv?: { filename: string; text: string } }
```
- Produces (`till/till.ts`): `createTill(host: TillHost)` returns:
  - `request(req: TillRequest): Promise<TillResponse>` (every route of today's `api()`, with the same status codes and messages);
  - `canFollow(session?: string): boolean`;
  - `followTablet(session: string | undefined, onFrame: (json: string) => void, onEnd: () => void): () => void` (sends one frame at once; `onEnd` when the session ends, as `broadcast()` does today);
  - `followWall(onFrame: (json: string) => void): () => void`;
  - `wallMenuJson(): string`;
  - `start(): void` (sync, the backup timer, the 20 s and server-minute wall frames);
  - `pause(): void` (stops the sync timer and the wall timers);
  - `resume(): void` (`sync.runOnce()` now, a fresh wall frame, the timers back on);
  - `status(): SyncStatus`;
  - `store: Store`.
- `export type Till = ReturnType<typeof createTill>` (used by Tasks 8–10).
- `Bootstrap` gains `host: 'node' | 'android'` and `firstRun: 'pins' | 'connect'`.
- `createPinDirectory({ staffPin, managerPin, staff, perPersonOnly?: boolean })`: with `perPersonOnly`, `mode()` is always `'per-person'`.
- Node host: `/api/wall/events` and `/api/wall/menu` add `Access-Control-Allow-Origin: *` (so the wall app can also follow a Mac till in development).

- [ ] **Step 1: Write the failing tests** in `till-router.test.ts`, using a temp `openNodeSqlite` database, temp `nodeFiles`, a fake `fetch` and fake timers:
  - `bootstrap reports host and firstRun`;
  - `connect mode refuses selling before pairing`: `POST /api/orders` gives 409 `{ error: 'Connect this till first.' }`; `GET /api/menu` gives 409;
  - `connect mode pairs without a PIN the first time`: fake `/v1/devices/pair` gives 200, and `POST /api/device/pair { code: '123456' }` gives 200 `{ name }`;
  - `connect mode wants a manager PIN to pair again after revoke`: `{ code }` alone gives 403;
  - `connect mode with no lead PIN`: `POST /api/session { pin: '000000' }` gives 401 `Wrong PIN.`, and `pinMode` is `'per-person'`;
  - `pins mode behaves as before`: `POST /api/session { pin: '1234' }` with `staffPin: '1234'` gives 200 and a session token;
  - `strikes are per client`: 8 wrong PINs from client `a` give 429 for `a`, while client `b` still gets 401;
  - `followTablet ends when the session ends`: `POST /api/session/end` calls `onEnd`;
  - `wall frames never carry the secret`: with `checkin_secret` set in kv, every `followWall` frame lacks the secret string;
  - `csv route returns csv`: `GET /api/report.csv?day=2026-11-22` gives `csv.filename === 'kennko-sales-2026-11-22.csv'`;
  - `resume runs one sync and one wall frame`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `createTill`.** Move `api()`, `broadcast`, `sendWall`, `checkPin`/`personalPin`/`needSession` (strikes keyed by `req.client`), `shopDetails`, `menu()`/`onMenu` and the timers out of `index.ts`, unchanged in behaviour. `index.ts` maps cookie ↔ `session`, `req.socket.remoteAddress` → `client`, `secureUrlFor(req)` → `secureUrl`, and `TillResponse` → HTTP. It keeps the startup console lines. The `firstRun === 'connect'` guard runs before the session check.
- [ ] **Step 4: Run, expect PASS.** `npm test && npm run typecheck`: PASS. Manual on the Mac: `npm run pos`, sign in, sell one drink, void it with the manager PIN, then `npm run wall:pos` and see the order walk in.
- [ ] **Step 5: Commit** `refactor(pos): one till router for the Node server and the app`.

---

### Task 5: Screens — transport, live feed, CSV, the first-run Connect screen  **[none]**

**Files:**
- Create: `apps/pos/src/transport.ts`, `apps/pos/src/screens/FirstRun.tsx`, `apps/pos/test/transport.test.ts`, `apps/pos/test/gateText.test.ts`, `apps/pos/src/gateText.ts`
- Modify: `apps/pos/src/api.ts`, `apps/pos/src/App.tsx`, `apps/pos/src/screens/History.tsx`, `apps/pos/src/screens/Till.tsx`, `apps/pos/src/screens/Gate.tsx`, `apps/pos/src/components/ConnectTill.tsx`, `apps/pos/src/main.tsx`

**Interfaces:**
- Produces (`transport.ts`):
```ts
export type Transport = {
  call(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<{ status: number; data: any }>
  follow(onLive: (json: string) => void, onDown: (closed: boolean) => void): () => void
  download(path: string, filename: string): Promise<void>
  exportBackup?: () => Promise<void>
}
export const httpTransport: Transport // fetch, EventSource('/api/events'), <a download>
export function setTransport(t: Transport): void
```
- `api.ts` keeps every existing name and adds:
  - `api.events(onLive: (live: Live) => void, onDown: (closed: boolean) => void): () => void`;
  - `api.exportCsv(day: string): Promise<void>`;
  - `api.exportBackup(): Promise<void>` (rejects with "Only in the Kennko POS app." on the HTTP transport).

  `call()` uses the current transport, and its 401 → `onLocked` handling and error copy stay as they are.
- `gateText.ts`: `gateNote(o: { pinMode: Bootstrap['pinMode']; host: Bootstrap['host']; noLeads: boolean }): string | null`.
- `Bootstrap` gains `noLeads: boolean` (paired, and no owner or manager in the staff cache). Set it in Task 4's router as part of this task.

- [ ] **Step 1: Write the failing tests.**
  - `transport.test.ts`, with a fake transport: `api.menu()` calls `call('GET', '/api/menu')`; a 401 calls the `setOnLocked` handler; `api.exportCsv('2026-11-22')` calls `download('/api/report.csv?day=2026-11-22', 'kennko-sales-2026-11-22.csv')`.
  - `gateText.test.ts`: `gateNote({ pinMode: 'per-person', host: 'android', noLeads: true })` equals `'No PINs yet. The owner issues them in admin › Staff, then tap Try again.'`; with `noLeads: false` it is `null`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - `App.tsx` replaces its `EventSource` effect with `api.events`, keeping the same reopen and `api.session()` logic.
  - When `boot.firstRun === 'connect' && boot.device === null`, `App` renders `FirstRun` (the logo plus `ConnectTill` without the PIN step) instead of `Gate`. `ConnectTill` takes `needsPin: boolean`.
  - History and Till call `api.exportCsv`.
  - `Gate` shows `gateNote` above the keypad.
  - `main.tsx` calls `startPwa()` only when `import.meta.env.VITE_TILL !== 'app'`.
- [ ] **Step 4: Run, expect PASS.** `npm test && npm run typecheck` pass. Manual: `npm run pos` still sells, exports a CSV and follows live.
- [ ] **Step 5: Commit** `feat(pos): screens talk through a transport; first-run Connect screen`.

---

### Task 6: New online orders — chime, banner, Orders badge  **[none]**

**Files:**
- Create: `apps/pos/src/onlineAlerts.ts`, `apps/pos/src/chime.ts`, `apps/pos/test/onlineAlerts.test.ts`
- Modify: `apps/pos/src/App.tsx`, `apps/pos/src/styles.css` (`.badge-new` amber, `.order-banner`), `apps/pos/src/components/ConnectTill.tsx` (clears the alert memory on connect)

**Interfaces:**
- Produces:
```ts
export type AlertMemory = { seen: string[] }
export const ALERT_KEY = 'kennko-online-seen'
export function nextOnlineAlerts(memory: AlertMemory | null, online: { id: string; label: string }[]): { memory: AlertMemory; fresh: string[] } // fresh = labels
export function bannerText(fresh: string[]): string
export function loadAlertMemory(): AlertMemory | null; export function saveAlertMemory(m: AlertMemory | null): void
```
  `chime.ts`: `playChime(): void` (two Web Audio notes, quiet). It unlocks its `AudioContext` on the first `pointerdown`.
- Check the online order's display label in `OnlineQueueOrder` (core). Use its `W<number>` form exactly as `onlineText.ts` already builds it.

- [ ] **Step 1: Write the failing tests** (`onlineAlerts.test.ts`):
  - `first load is the baseline`: `nextOnlineAlerts(null, [W1, W2]).fresh` equals `[]`, and `memory.seen` equals `['id1','id2']`;
  - `a new order is fresh once`: memory `{seen:['id1']}` with `[W1, W3]` gives `fresh ['W3']`; the same input again gives `[]`;
  - `seen is capped at 200`, keeping the newest;
  - `bannerText(['W3'])` equals `'New online order W3'`; `bannerText(['W3','W4','W5'])` equals `'3 new online orders'`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** On each `live`, `App` runs `nextOnlineAlerts`. When something is fresh: `playChime()`, the banner (`role="status"`, tap → `setTab('orders')`), and `newCount += fresh.length` unless the tab is `orders`. Opening Orders sets `newCount = 0` and hides the banner. The rail shows `<b className="badge badge-new">{newCount}</b>` while `newCount > 0`, else today's `activeCount` badge.
- [ ] **Step 4: Run, expect PASS.** Manual on the Mac: with the till connected, place a paid test order on the website. Within about 15 s it chimes, the banner shows "New online order W…", and the badge clears when Orders opens.
- [ ] **Step 5: Commit** `feat(pos): chime, banner and badge for new online orders`.

---

### Task 7: `android/kennko-kit` — the SQLite bridge  **[none]** (JVM tests on the Mac)

**Files:**
- Create: `android/kennko-kit/build.gradle`, `android/kennko-kit/src/main/AndroidManifest.xml`, `android/kennko-kit/src/main/java/coffee/kennko/kit/SqliteBridge.kt`, `android/kennko-kit/src/main/java/coffee/kennko/kit/SqlitePlugin.kt`, `android/kennko-kit/src/test/java/coffee/kennko/kit/SqliteBridgeTest.kt`, `android/kennko-kit/README.md`
- Create (POS Capacitor project, so the kit has a Gradle home): `apps/pos/capacitor.config.ts`, `apps/pos/android/` (`npx cap add android`)
- Modify: `apps/pos/android/settings.gradle` (`include ':kennko-kit'`, `project(':kennko-kit').projectDir = new File('../../../android/kennko-kit')`), `apps/pos/android/app/build.gradle` (`implementation project(':kennko-kit')`), `apps/pos/package.json` (Capacitor deps pinned), `.gitignore` (`/apps/pos/dist-app/`)

**Interfaces:**
- Produces (`SqliteBridge`, pure JVM, `androidx.sqlite.driver.bundled.BundledSQLiteDriver`):
  - `class SqliteBridge(private val root: File)`;
  - `fun call(requestJson: String): String`, where the request is `{op, db?, file?, sql?, params?}`:
    - `op` is one of `open` (returns `{db: Int}`; `file` is relative to `root` or an absolute path inside `root`, else an error), `exec`, `run` (returns `{changes, lastInsertRowid}`), `get` (returns `{row: {...} | null}`), `all` (returns `{rows: [...]}`) or `close`;
    - errors come back as `{error: "<SQLite message>"}`.
  - Params: an integral JSON number is bound with `bindLong`, any other number with `bindDouble`, a string with `bindText`, `null` with `bindNull`, and a boolean as 0/1. Rows: INTEGER gives a JSON number, REAL a number, TEXT a string, NULL `null`, and a BLOB is an error.
  - Each connection keeps a statement cache keyed by SQL (LRU of 64), and every call is `synchronized`.
- `SqlitePlugin` (Capacitor plugin `KennkoSqlitePlugin`):
  - in `load()`, `bridge.webView.addJavascriptInterface(Js(SqliteBridge(context.filesDir.parentFile!!)), "KennkoSqlite")`;
  - `Js` exposes `@JavascriptInterface fun call(json: String): String` and `@JavascriptInterface fun backupPath(day: String): String`. `backupPath` returns `filesDir/backups/pos-<day>.db`, refuses a `day` that does not match `^\d{4}-\d{2}-\d{2}$`, and deletes all but the newest 30 `pos-*.db` files.
  - The till database is `databases/pos.db` under the app's data directory.

- [ ] **Step 1: Write the failing JVM tests** (`SqliteBridgeTest`, using a JUnit `TemporaryFolder` as root):
  - `opens and round-trips types`: insert `1732233600123`, `null` and `"Ñoño ☕🐈"`, then `get` gives the same three;
  - `run reports changes and rowid`: rowid is 1 then 2; an update matching nothing reports changes 0;
  - `unique violation keeps the SQLite message`: the error contains `UNIQUE constraint failed`;
  - `transaction rollback leaves nothing`;
  - `refuses a path outside root`: `{op:'open', file:'/etc/x.db'}` gives an `error`;
  - `vacuum into makes a copy` that opens and holds the row;
  - `blob column is refused`.
- [ ] **Step 2: Run, expect FAIL.**
  Run: `cd apps/pos/android && ./gradlew :kennko-kit:testDebugUnitTest`
  Expected: compilation failure (`SqliteBridge` not found).
- [ ] **Step 3: Implement `SqliteBridge` and `SqlitePlugin`.** Use `org.json` for JSON (from the Android SDK; on the JVM tests add `testImplementation 'org.json:json:<pinned>'`). Open each connection with `pragma journal_mode = wal; pragma synchronous = full; pragma foreign_keys = on` left to the store, which issues them itself.
- [ ] **Step 4: Run, expect PASS.** Same command: `BUILD SUCCESSFUL`, 7 tests. Root `npm test && npm run typecheck`: PASS.
- [ ] **Step 5: Commit** `feat(android): kennko-kit with a synchronous native SQLite bridge`.

---

### Task 8: Kennko POS app shell — the till core in the WebView  **[emulator]**, PIN timing on **[Samsung]**

**Files:**
- Create: `apps/pos/src/app/sqlite-bridge.ts`, `apps/pos/src/app/app-files.ts`, `apps/pos/src/app/native-fetch.ts`, `apps/pos/src/app/inapp-transport.ts`, `apps/pos/src/app/boot.ts`, `apps/pos/src/app/selftest.ts`, `apps/pos/test/native-fetch.test.ts`, `apps/pos/test/inapp-transport.test.ts`, `scripts/build-pos-app.mjs`, `apps/pos/android/app/src/main/java/coffee/kennko/pos/MainActivity.kt`, `apps/pos/android/app/src/debug/res/xml/network_security_config.xml` (cleartext to `localhost` only, debug builds)
- Modify: `apps/pos/src/main.tsx` (when `VITE_TILL === 'app'`, `await bootApp()` before rendering), `apps/pos/vite.config.ts` (mode `app`: `outDir: 'dist-app'`, no `offlineCopy`), `apps/pos/package.json` (scripts `app:build`, `app:apk`), root `package.json` (scripts `pos:apk`, `wall:apk`), `apps/pos/capacitor.config.ts` (`webDir: 'dist-app'`, `plugins.CapacitorHttp.enabled: false`), `apps/pos/android/app/src/main/AndroidManifest.xml` (`screenOrientation="landscape"`, `CAMERA`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, `REQUEST_INSTALL_PACKAGES`, `INTERNET`, `ACCESS_NETWORK_STATE`, `CHANGE_WIFI_MULTICAST_STATE`)

**Interfaces:**
- Consumes: `createTill`, `TillHost`, `TillConfig` (Task 4); `Transport`, `setTransport` (Task 5); the `KennkoSqlite` JS interface (Task 7); `runSqlContract` (Task 3).
- Produces:
  - `openBridgeSqlite: SqlOpen` (`sqlite-bridge.ts`): JSON over `window.KennkoSqlite.call`; `{error}` becomes `throw new Error(message)`.
  - `bridgeBackupPath(day: string): string`.
  - `appFiles(store: Store): TillFiles` (`kv` rows `file:<name>`).
  - `nativeFetch(http: Pick<typeof CapacitorHttp, 'request'>): typeof fetch`, which:
    - passes method, headers and a JSON or string body;
    - returns a `Response` with the status, every header (including `date`) and the body as text;
    - maps `init.signal` abort to `DOMException('Aborted', 'AbortError')`;
    - turns a network error into a rejected `TypeError`.
  - `inAppTransport(till: Till): Transport`: the session token lives in module memory only; `TillResponse.session` sets or clears it; a CSV and the backup are shared through Task 9's `share.ts`.
  - `bootApp(): Promise<void>` builds the host:
    - `sql = openBridgeSqlite('databases/pos.db')`;
    - `config = { staffPin: '', managerPin: '', shop: defaults from config.example.json, discounts: [], apiUrl: import.meta.env.VITE_KENNKO_API_URL, firstRun: 'connect' }`;
    - `baseMenu = builtInMenu(now)`;
    - `host: 'android'`.
    
    It then calls `createTill(host).start()` and `setTransport(inAppTransport(till))`.
- `scripts/build-pos-app.mjs [--release] [--selftest]`: sets `VITE_TILL=app`, `VITE_KENNKO_API_URL` from `KENNKO_API_URL`, and `VITE_SELFTEST=1` with `--selftest`. Then it runs `vite build --mode app`, `npx cap sync android` and `./gradlew assembleDebug` (or `assembleRelease` with `--release`). With `--release` it refuses an empty or non-`https://` URL with `KENNKO_API_URL must be the production https address`.
- `MainActivity`: registers the kit plugins before `super.onCreate`, and sets `webView.settings.mediaPlaybackRequiresUserGesture = false`.

- [ ] **Step 1: Write the failing tests.**
  - `native-fetch.test.ts`, with a fake `request`:
    - `keeps the Date header`: `res.headers.get('date')` equals the fake's;
    - `posts JSON`: the fake sees `data` equal to the parsed body and `content-type: application/json`;
    - `401 stays a response`, not a throw;
    - `abort rejects with AbortError` within 10 ms of `controller.abort()`;
    - `network failure rejects TypeError`.
  - `inapp-transport.test.ts`, with a real `createTill` on `openNodeSqlite` and `firstRun: 'pins'`, `staffPin: '1234'`:
    - `session token is kept in memory`: `call('POST','/api/session',{pin:'1234'})` and then `call('GET','/api/menu')` gives 200;
    - `lock clears the token`: after `/api/session/end`, `/api/menu` gives 401;
    - `follow delivers frames`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement the modules and `bootApp`.** `selftest.ts`, when `VITE_SELFTEST === '1'`, runs `runSqlContract(openBridgeSqlite, 'databases/selftest.db')`, then logs `KENNKO_SELFTEST PASS` or `KENNKO_SELFTEST FAIL <reasons>`, then continues booting.
- [ ] **Step 4: Run, expect PASS.** `npm test && npm run typecheck`: PASS.
- [ ] **Step 5: Emulator check.**
  Run: `KENNKO_API_URL=$KENNKO_API_URL node scripts/build-pos-app.mjs --selftest`, then `adb -s emulator-5554 install -r apps/pos/android/app/build/outputs/apk/debug/app-debug.apk && adb shell am start -n coffee.kennko.pos/.MainActivity`, then `adb logcat -d | grep KENNKO_SELFTEST`.
  Expected: `KENNKO_SELFTEST PASS`. The app opens on **Connect this till**.
- [ ] **Step 6: Emulator check against a non-production API.** Point a debug build at a local `npm run dev -w @kennko/api` (via `adb reverse tcp:8787 tcp:8787` and `KENNKO_API_URL=http://localhost:8787`; debug builds allow cleartext to localhost only). Pair with a code from that API's admin, sign in with an issued PIN, sell one drink, and see the outbox drain (Menu › This till shows no "waiting").
- [ ] **Step 7: Manual (Julius, Samsung, debug build, non-production API).** Time a PIN sign-in with 6 or more staff in the list.
  - Under 2 s: done.
  - Over 2 s: report it, and the follow-up is a per-session memo of the matched staff id (not in this plan).
- [ ] **Step 8: Commit** `feat(pos-app): the till core runs inside Kennko POS on Android`.

---

### Task 9: Kennko POS app — always on, sleep and wake, backups, camera  **[emulator]**, battery and camera on **[Samsung]**

**Files:**
- Create: `apps/pos/src/app/lifecycle.ts`, `apps/pos/src/app/share.ts`, `apps/pos/test/lifecycle.test.ts`, `android/kennko-kit/src/main/java/coffee/kennko/kit/Kiosk.kt`, `android/kennko-kit/src/main/java/coffee/kennko/kit/KioskPlugin.kt`
- Modify: `apps/pos/src/app/boot.ts`, `apps/pos/src/screens/MenuScreen.tsx` ("Export backup" in This till when `boot.host === 'android'`), `apps/pos/android/app/src/main/java/coffee/kennko/pos/MainActivity.kt`

**Interfaces:**
- Consumes: `till.pause()`, `till.resume()`, `host.backup` (Task 4); `bridgeBackupPath` (Task 8).
- Produces:
  - `wireLifecycle(till: Pick<Till, 'pause' | 'resume'>, app: { addListener(e: 'pause' | 'resume', fn: () => void): unknown }): void` (`@capacitor/app` in production);
  - `appBackup(snapshot: (file: string) => void, now: number): string` (`snapshot(bridgeBackupPath(manilaDay(now)))`, never throws);
  - `shareFile(path: string, title: string): Promise<void>` and `shareText(filename: string, text: string): Promise<void>` (`@capacitor/filesystem` + `@capacitor/share`);
  - `KioskPlugin` (JS `KennkoKiosk`): `askBatteryOnce() → { asked: boolean }`. It opens `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` once, remembered in SharedPreferences, and does nothing if the app is already exempt.
  - `Kiosk.keepScreenOn(activity)` (`FLAG_KEEP_SCREEN_ON`).
  - `api.exportBackup()` on Android: `host.backup` now, then `shareFile(latest, 'Kennko POS backup')`. The UI copy reads "Keep it private: it has staff PINs (scrambled) and sales."

- [ ] **Step 1: Write the failing tests** (`lifecycle.test.ts`):
  - `pause pauses the till`;
  - `resume resumes the till once per resume`;
  - `appBackup returns an error line instead of throwing` when `snapshot` throws;
  - `appBackup names the file by Manila day` (a clock at `2026-11-21T16:30:00Z` gives `pos-2026-11-22.db`).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** In `bootApp`: `wireLifecycle(till, App)`, `KennkoKiosk.askBatteryOnce()` after the first successful sign-in, and `Kiosk.keepScreenOn` in `MainActivity.onCreate`. Camera: keep `QrScanner` (`getUserMedia`). Capacitor's chrome client asks for `CAMERA` at runtime.
- [ ] **Step 4: Run, expect PASS.** `npm test && npm run typecheck`: PASS.
- [ ] **Step 5: Emulator check (update keeps data — Review Focus 1).**
  1. Build and install, pair with the local API, sell two drinks with the API stopped (the outbox holds them; This till says "2 sales waiting").
  2. Bump `apps/pos/package.json` patch, rebuild, `adb install -r`.
  3. Open the app: sign in with the same PIN; History shows both sales and This till still says "2 sales waiting".
  4. Start the API: the count drops to 0 within 30 s.
  5. Background the app (Home) and return: logcat shows one sync run on resume.
  6. Export backup opens the share sheet with `pos-<day>.db`.
- [ ] **Step 6: Manual (Julius, Samsung).**
  1. The battery prompt appears once after the first sign-in.
  2. Scan a Kennko card QR with the camera.
  3. Let the screen time out with the app open: it stays on.
  4. Press power, wait 2 minutes, wake: the Offline pill does not stick, and a website order placed meanwhile chimes within 15 s of waking.
- [ ] **Step 7: Commit** `feat(pos-app): screen on, catch up on wake, backups and export`.

---

### Task 10: The wifi wall feed and the network announcement  **[none]** (JVM) + **[emulator]**, NSD on **[Samsung]**

**Files:**
- Create: `android/kennko-kit/src/main/java/coffee/kennko/kit/WallFeedServer.kt`, `android/kennko-kit/src/main/java/coffee/kennko/kit/FeedPlugin.kt`, `android/kennko-kit/src/test/java/coffee/kennko/kit/WallFeedServerTest.kt`, `apps/pos/src/app/feed.ts`, `apps/pos/test/feed.test.ts`
- Modify: `apps/pos/src/app/boot.ts`

**Interfaces:**
- Produces (`WallFeedServer`, pure JVM):
  - `class WallFeedServer(port: Int = 4466, keepaliveMs: Long = 20_000)`;
  - `fun start()`, `fun stop()`, `fun publish(frameJson: String)`, `fun setMenu(menuJson: String)`, `val clientCount: Int`.
  - Routes:
    - `GET /api/wall/events` answers `200 text/event-stream` with `cache-control: no-store` and `access-control-allow-origin: *`, then `retry: 2000\n\n`, then the latest frame as `data: …\n\n` if any;
    - `GET /api/wall/menu` answers `200 application/json` with `{"menu": <menuJson>}`;
    - anything else is 404, and any method other than GET is 405.
  - One thread per connection. A request line or headers over 8 KB close the connection. At most 8 SSE clients; the oldest is dropped.
- `FeedPlugin` (JS `KennkoFeed`):
  - `publish({ frame: string })` and `setMenu({ menu: string })`;
  - `handleOnStart` starts the server and registers NSD (`_kennko-pos._tcp.`, `Kennko POS`, 4466, TXT `v=1`);
  - `handleOnStop` unregisters and stops.
- `wireFeed(till: Pick<Till, 'followWall' | 'wallMenuJson'>, feed: { publish(o: { frame: string }): Promise<void>; setMenu(o: { menu: string }): Promise<void> }): () => void` sends each wall frame and refreshes the menu whenever the frame's menu key changes.

- [ ] **Step 1: Write the failing JVM tests** (`WallFeedServerTest`, on an ephemeral port, using `HttpURLConnection` and raw sockets):
  - `events sends retry then latest frame`;
  - `publish reaches every client`;
  - `menu route wraps json`;
  - `unknown path 404`;
  - `POST 405`;
  - `oversized headers closed`;
  - `stop closes clients`;
  - `ninth client drops the oldest`.
- [ ] **Step 2: Write the failing JS test** (`feed.test.ts`): `wireFeed forwards frames` and `wireFeed sends the menu once per change`.
- [ ] **Step 3: Run, expect FAIL** (`./gradlew :kennko-kit:testDebugUnitTest`; `npm test -w @kennko/pos`).
- [ ] **Step 4: Implement.** `bootApp` calls `wireFeed(till, KennkoFeed)`.
- [ ] **Step 5: Run, expect PASS.** Root tests and typecheck pass.
- [ ] **Step 6: Emulator check.** Run `adb forward tcp:4466 tcp:4466 && curl -N http://localhost:4466/api/wall/events`. Expected: `retry: 2000` then a `data: {"day":…` frame. A sale on the emulator shows a new frame within 1 s. Then on the Mac, `node wall/server.mjs --pos http://localhost:4466`: the order walks in.
- [ ] **Step 7: Manual (Julius, Samsung + Mac on the shop wifi).**
  1. `dns-sd -B _kennko-pos._tcp` on the Mac lists `Kennko POS`.
  2. `node wall/server.mjs --pos http://<tablet-ip>:4466` follows the Samsung.
  3. Press power on the Samsung: the wall shows Reconnecting and the QR card disappears.
- [ ] **Step 8: Commit** `feat(pos-app): wall feed on the shop wifi, announced as Kennko POS`.

---

### Task 11: Wall page — shared feed parsing, the follower, sound effects instead of music  **[none]**

**Files:**
- Create: `wall/public/pos-feed.mjs`, `wall/public/follow.mjs`, `wall/public/sfx.mjs`, `wall/test/follow.test.mjs`, `wall/test/scene-events.test.mjs`
- Modify:
  - `wall/pos-link.mjs`: re-exports `fromPosFeed`, `sseParser` and `agedVisit` from `./public/pos-feed.mjs`, and keeps `followPos`;
  - `wall/server.mjs`: the `--pos` block uses `createFollower`; the `/api/playlist` and music routes are removed;
  - `wall/public/wall.mjs`: the music player goes, `sfx` comes in; `listen()` accepts a source;
  - `wall/public/scene/logic.mjs`: `sceneEvents`, and `trackTitle` removed;
  - `wall/public/index.html`: the `#music` element goes;
  - `wall/README.md` (no music; sound effects; `M` mutes);
  - `.gitignore`: drop the `/wall/music/*` lines and delete `wall/music/.gitkeep`.

**Interfaces:**
- Produces (`pos-feed.mjs`, browser-safe and identical in behaviour to today's `pos-link.mjs`): `fromPosFeed(feed, baristas)`, `sseParser(onData)`, `agedVisit(visit, receivedAt, now)`.
- Produces (`follow.mjs`): `createFollower({ baristas: number, board: boolean, now: () => number, onSnapshot: (s: { state, now, visit }) => void })` returns:
  - `feed(raw: unknown): void`;
  - `up(): void`;
  - `down(): void` (clears `visit.checkin` at once and keeps the orders when `board`; with no board, the made-up cafe stands in after 15 s, as today);
  - `snapshot(): { state, now, visit }`;
  - `menu(): { category: string; items: { name: string; star: boolean }[] }[]`.
- Produces (`logic.mjs`): `sceneEvents(prev: { orders, visitors } | null, next: { orders, visitors }): ('join' | 'preparing' | 'ready' | 'catIn' | 'catOut')[]`. It returns `[]` when `prev` is null, emits at most one event of each kind per call, and treats `cancelled` as nothing.
- Produces (`sfx.mjs`): `createSfx(ctx: AudioContext | null)` returns `{ play(kind): void; muted: boolean; volume: number }`. The volume defaults to `0.15`. `ready` is today's bell; the other sounds are short synth chirps (join: a soft pop; preparing: a low tick; catIn: a rising two-note mew; catOut: a falling one).

- [ ] **Step 1: Write the failing tests.**
  - `follow.test.mjs`:
    - `feed builds the wall sheet` (same output as `fromPosFeed` for a sample feed);
    - `down clears the QR but keeps orders on the board`;
    - `down without board stands in after 15s` (fake clock);
    - `up after down resumes the till's orders`;
    - `garbled feed is ignored`.
  - `scene-events.test.mjs`:
    - first frame gives `[]`;
    - a new queued order gives `['join']`;
    - queued → preparing gives `['preparing']`;
    - → serving gives `['ready']`;
    - a new visitor key gives `['catIn']`;
    - a visitor gone gives `['catOut']`;
    - three new orders give `['join']` once;
    - a voided order gives `[]`.
- [ ] **Step 2: Run, expect FAIL** (`node --test wall/test/*.test.mjs`).
- [ ] **Step 3: Implement.** `server.mjs` behaviour under `--pos` stays the same, now through `createFollower`. `wall.mjs` calls `sfx.play` for each `sceneEvents` result in `apply()`, keeping the banner bell. The `M` key toggles `sfx.muted`.
- [ ] **Step 4: Run, expect PASS.** All wall tests pass, including the existing `pos-link.test.mjs` unchanged. Root `npm test && npm run typecheck` pass. Manual: `npm run pos` + `npm run wall:pos`; a sale pops, Start ticks, Ready rings.
- [ ] **Step 5: Commit** `feat(wall): sound effects for scene events instead of music; shared feed follower`.

---

### Task 12A: Kennko Wall app — branch A, system WebView  **[emulator]** + **[projector]**  *(only if PROBE.md says branch A)*

**Files:**
- Create: `wall/public/app/boot.mjs`, `wall/public/app/finder.mjs`, `wall/public/app/settings.mjs`, `wall/test/finder.test.mjs`, `apps/wall-app/scripts/copy-wall.mjs`, `android/kennko-kit/src/main/java/coffee/kennko/kit/FindPlugin.kt`, `apps/wall-app/android/app/src/main/java/coffee/kennko/wall/MainActivity.kt`, `apps/wall-app/android/app/src/main/res/xml/network_security_config.xml`
- Modify:
  - `wall/public/wall.mjs`: with `window.Capacitor?.isNativePlatform()`, `start()` imports `./app/boot.mjs` instead of fetching `/api/bootstrap` and opening `/api/events`;
  - `apps/wall-app/capacitor.config.ts`: `webDir: 'www'`;
  - `apps/wall-app/package.json`: `build` runs `copy-wall`; `apk`;
  - `apps/wall-app/android/settings.gradle` and `app/build.gradle`: the kit;
  - `BootReceiver.kt`: kept from the probe;
  - delete `ProbePlugin.kt` and `www-probe/`.

**Interfaces:**
- Consumes: `createFollower`, `sceneEvents`, `createSfx` (Task 11); the feed protocol (Task 10, Ruling 8).
- Produces (kit): `class TillFinder(context: Context)` with `fun find(timeoutMs: Long): Pair<String, Int>?` (blocking; NSD discovery + resolve), which `FindPlugin` wraps and Task 12B reuses.
- Produces (`FindPlugin`, JS `KennkoFind`): `find({ timeoutMs: number }) → { host: string; port: number } | { none: true }`. It uses NSD discovery of `_kennko-pos._tcp.`, resolves the first service named `Kennko POS`, and holds a `WifiManager.MulticastLock` while looking.
- Produces (`finder.mjs`):
```js
/** @returns {{ start(): void, stop(): void, retry(): void }} */
export function createFinder({ find, open, saved, manual, now, wait, onState })
// find: () => Promise<{host,port}|{none:true}>; open: (url) => { close(): void } (EventSource wrapper calling onUp/onFrame/onDown)
// order each round: discovered → last good (saved.get()) → manual; a good connection saves its URL; rounds repeat every 10 s
// onState('looking' | 'connected' | 'lost', detail)
```
  On-screen copy (pinned):
  - `looking`: `Looking for Kennko POS on the wifi…`;
  - `lost` after 30 s: `Can't find Kennko POS. Is the tablet on, with Kennko POS open? Still looking.`;
  - `connected`: nothing shown.
- A 45 s watchdog with no data frame closes the connection and calls `onDown` (frames come at least every 20 s, Ruling 7).
- `settings.mjs`: `openSettings()` shows an overlay with the Ruling 11 items. It opens on keydown `ContextMenu`, or on `Enter` held 3 s (by `e.repeat` duration). The keys are `localStorage['kennko-wall-till']` and `['kennko-wall-sfx']`.
- `MainActivity`: immersive full screen (`WindowInsetsControllerCompat`, hidden system bars), `Kiosk.keepScreenOn`, `mediaPlaybackRequiresUserGesture = false`, and the start button focused so OK presses it.
- `network_security_config.xml`: cleartext allowed (the wall talks only to the LAN; there is no internet use besides the update JSON over https).

- [ ] **Step 1: Write the failing tests** (`finder.test.mjs`, with fake `find`, `open` and clock):
  - `connects to the discovered till and saves it`;
  - `falls back to the saved address when discovery finds nothing`;
  - `then to the manual address`;
  - `says lost after 30s without a connection` (exact copy);
  - `reconnects after a drop without blanking` (`onState('looking')` but no reset of the follower);
  - `watchdog closes a silent connection after 45s`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the finder, settings and boot. `boot.mjs` wires finder → `createFollower` → `apply()`. It sets `boot = { ambient: false, pos: true, boardSize: 5 }` and sets the `#link` pill text from `onState`. Then implement `FindPlugin` and `MainActivity`.
- [ ] **Step 4: Run, expect PASS.** `node --test wall/test/*.test.mjs` and root tests and typecheck pass.
- [ ] **Step 5: TV emulator check.**
  1. Run the Node till on the Mac (`npm run pos`).
  2. Install the wall APK on `kennko-tv`.
  3. Open hidden settings (Menu key) and set Till address `http://10.0.2.2:4466`.
  4. Press OK on the start button.

  Expected: a sale on the Mac till walks in with a pop. Ready rings. Stopping the till shows the looking copy and hides the QR, and restarting the till recovers within 15 s.
- [ ] **Step 6: Manual (Julius, projector + Samsung on the shop wifi, debug builds).**
  1. Open Kennko Wall and press OK once: it finds Kennko POS with nothing typed.
  2. A sale on the Samsung walks in.
  3. The check-in QR scans on a phone.
  4. Turning the Samsung's screen off clears the QR, and on wake it returns within 20 s.
  5. Reboot the projector: Kennko Wall opens by itself, or note the extra step from PROBE.md.
- [ ] **Step 7: Commit** `feat(wall-app): Kennko Wall finds the till on the wifi and follows it`.

### Task 12B: Kennko Wall app — branch B, bundled GeckoView  *(only if PROBE.md says branch B; replaces Task 12A's Android project)*

**Files:**
- Replace `apps/wall-app/android/` with a plain Gradle Android app (no Capacitor) using `org.mozilla.geckoview:geckoview` (pinned) that includes `:kennko-kit`. `copy-wall.mjs` copies the page into `app/src/main/assets/www/`.
- Create: `apps/wall-app/android/app/src/main/java/coffee/kennko/wall/MainActivity.kt`, `apps/wall-app/android/app/src/main/java/coffee/kennko/wall/AssetServer.kt`
- Keep `finder.mjs`, `settings.mjs` and `boot.mjs` and their tests from Task 12A. Only the bridge differs.
- The kit's Capacitor plugin classes compile against `capacitor-android`, so 12B keeps `@capacitor/android` as a plain library dependency (no Capacitor bridge or WebView is used).

**Interfaces:**
- `AssetServer` (a kit-style pure JVM class, with a JVM test) serves `assets/www` on `127.0.0.1:4455`. The page loads from `http://127.0.0.1:4455/`, so ES modules and EventSource behave as in the browser.
- Native calls from the page go to `http://127.0.0.1:4455/native/find` (JSON `{host,port}|{none:true}`, using `TillFinder` from the kit) and `/native/update` (Task 13's check and install). `boot.mjs` uses `fetch` to these paths when `window.Capacitor` is absent and `location.port === '4455'`.
- `MainActivity`: GeckoView full screen, the same kiosk flags as Task 12A, and dpad events passed through to the page.

- [ ] **Step 1:** JVM tests for `AssetServer`: `serves index.html`, `serves .mjs as text/javascript`, `refuses path traversal ../`, `native/find answers JSON`. Run them, expect FAIL, implement, expect PASS.
- [ ] **Step 2:** The Task 12A Step 5 emulator check and Step 6 projector check, unchanged.
- [ ] **Step 3: Commit** `feat(wall-app): Kennko Wall on bundled GeckoView for the projector's old WebView`.

---

### Task 13: In-app updates for both apps  **[none]** (JVM) + **[emulator]**

**Files:**
- Create: `android/kennko-kit/src/main/java/coffee/kennko/kit/UpdateCheck.kt`, `android/kennko-kit/src/main/java/coffee/kennko/kit/UpdatePlugin.kt`, `android/kennko-kit/src/main/res/xml/kennko_files.xml`, `android/kennko-kit/src/test/java/coffee/kennko/kit/UpdateCheckTest.kt`, `android/kennko-kit/version.gradle`, `apps/web/public/apps/updates.json`, `apps/pos/src/app/UpdateBanner.tsx`, `wall/public/app/update.mjs`, `scripts/release-apk.mjs`, `scripts/release-apk.test.mjs`
- Modify: both apps' `app/build.gradle` (`apply from: kit version.gradle`, which sets `versionName` and `versionCode` from `package.json`), `apps/pos/src/App.tsx` (shows `UpdateBanner` when the host is android), `wall/public/app/settings.mjs` and `boot.mjs` (banner plus the Check for update item), root `package.json` (`"test"` also runs `node --test scripts/*.test.mjs`)

**Interfaces:**
- Produces (`UpdateCheck`, pure JVM):
  - `data class UpdateEntry(val versionCode: Int, val versionName: String, val url: String, val notes: String)`;
  - `fun parseUpdates(json: String, app: String): UpdateEntry?` (null on malformed input, an unknown app, a non-https `url`, or `versionCode < 1`);
  - `fun isNewer(entry: UpdateEntry?, installed: Long): Boolean`.
- Produces (`UpdatePlugin`, JS `KennkoUpdate`, `app` = `'pos' | 'wall'` from plugin config):
  - `check() → { available: false } | { available: true, versionName, notes }`. It fetches `https://kennko.vercel.app/apps/updates.json` (5 s timeout) at start and every 24 h while open. A failure means `{ available: false }`.
  - `install() → { started: true } | { error: string }`. It downloads the APK to `cacheDir/update.apk` and installs it through a `PackageInstaller` session. If "Install unknown apps" is off for the app, it first opens `ACTION_MANAGE_UNKNOWN_APP_SOURCES` for this package and returns `{ error: 'Allow Kennko to install updates, then tap Update again.' }`.
- `version.gradle`: `versionCode = major*10000 + minor*100 + patch` from `../../package.json` `version`.
- `updates.json` starts as `{ "pos": { "versionCode": 0, … }, "wall": { "versionCode": 0, … } }`, so nothing is offered until the first release entry.
- `scripts/release-apk.mjs <pos|wall> <apk-url>`:
  - reads the workspace version, computes `versionCode`, and refuses unless it is greater than `updates.json[app].versionCode` (`versionCode 10002 is not newer than 10002 in updates.json`);
  - refuses a non-https URL;
  - writes the entry with `notes` from `--notes "…"`;
  - exports pure `nextUpdates(current, app, entry)` for the test.
- Banner copy:
  - POS: `Update available: Kennko POS 1.0.3. <notes>`, with an [Update] button;
  - wall: `Update available — open settings (hold OK) to install.`

- [ ] **Step 1: Write the failing tests.**
  - `UpdateCheckTest`: `parses entry`, `unknown app null`, `http url refused`, `malformed null`, `isNewer only when greater`.
  - `release-apk.test.mjs`: `refuses equal versionCode`, `refuses http url`, `writes entry for wall leaving pos untouched`.
- [ ] **Step 2: Run, expect FAIL** (`./gradlew :kennko-kit:testDebugUnitTest`; `node --test scripts/release-apk.test.mjs`).
- [ ] **Step 3: Implement.** Add a `FileProvider` with authority `${applicationId}.kennko.files` in the kit manifest, the `REQUEST_INSTALL_PACKAGES` permission (already in POS; add it to the wall), and the `PackageInstaller` status receiver. A failed install shows `The update did not install. Try again, or ask Julius.`
- [ ] **Step 4: Run, expect PASS.** Root `npm test && npm run typecheck` pass.
- [ ] **Step 5: Emulator check.**
  1. Serve a local `updates.json` with a higher `versionCode` (a debug-only override: `KennkoUpdate` reads `updatesUrl` from plugin config, and only debug builds may set it).
  2. Tap Update on the tablet emulator: Android's Install prompt appears.
  3. Accept: the app reopens on the new version with the sales and the pairing intact.
- [ ] **Step 6: Commit** `feat(android): update check and in-place install for Kennko POS and Kennko Wall`.

---

### Task 14: Release signing, docs, and the go-live checklist  **[Samsung]** + **[projector]** (Julius)

**Files:**
- Create: `android/kennko-kit/signing.gradle`, `docs/android-release.md`
- Modify:
  - both apps' `app/build.gradle`: `apply from` `signing.gradle`, which reads `~/.kennko/keystore.properties` (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`). `assembleRelease` fails with `Release signing needs ~/.kennko/keystore.properties (see docs/android-release.md)` when it is missing;
  - `apps/pos/README.md`: a new "Kennko POS on the tablet" section first, with the Node till kept as "On a Mac, for development";
  - `wall/README.md`: "Kennko Wall on the projector" first;
  - the admin Guide: `apps/web/app/admin/guide/content.ts` gets Tills and Wall sections for the APKs, and `content.test.ts` passes;
  - `deploy/windows/`: delete `setup.cmd`, `setup.ps1` and `run.ps1`, and replace `README.md` with one line pointing to `docs/android-release.md`. **Julius has uncommitted edits in `deploy/windows/README.md`: ask before touching it, and leave it unstaged if he says so.**
  - root `CLAUDE.md`: one line on `android/kennko-kit` and `apps/wall-app`.

**Interfaces:**
- Consumes: everything above. Produces no code interfaces.

- [ ] **Step 1: Test the signing guard.** Run `cd apps/pos/android && ./gradlew assembleRelease` with no `~/.kennko/keystore.properties`.
  Expected: FAIL with the message above. Run `git status --porcelain | grep -E '\.(jks|keystore|apk)|keystore\.properties'`. Expected: no output.
- [ ] **Step 2: Write the docs.** In `docs/android-release.md`, the checklist below, verbatim, with the exact commands.
- [ ] **Step 3: Run** `npm test && npm run typecheck`: PASS. **Commit** `docs: Android release and go-live; retire deploy/windows`.

**Go-live checklist (Julius, in `docs/android-release.md`):**
1. **Make the release key once:**

   ```bash
   mkdir -p ~/.kennko && keytool -genkeypair -v -keystore ~/.kennko/kennko-release.jks -alias kennko -keyalg RSA -keysize 4096 -validity 36500
   ```

   Then write `~/.kennko/keystore.properties`. **Back up both files and the passwords in two places** (a password manager plus a USB stick kept at home). Losing them means every future update needs an uninstall, which wipes the tablet's unsynced sales.
2. **Build the signed APKs:** `npm run pos:apk -- --release` (with `KENNKO_API_URL` set to production) and `npm run wall:apk -- --release`. Check each with `apksigner verify --print-certs`: both apps show the same certificate SHA-256.
3. **Host the APKs:** in Supabase › Storage, create a public bucket `apps` once. Upload to `apps/<32 random hex>/kennko-pos-<version>.apk` and `kennko-wall-<version>.apk`, then copy the public URLs.
4. Run `node scripts/release-apk.mjs pos <url> --notes "…"` and the same for `wall`. Commit `apps/web/public/apps/updates.json` and push; the website deploy publishes it.
5. **Samsung tablet:**
   1. Allow "Install unknown apps" for the browser or file manager, then install Kennko POS from the URL.
   2. Open it. On **Connect this till**, type a code from admin › Tills (name it "Counter tablet").
   3. Issue staff PINs in admin › Staff if not done already, and sign in.
   4. Accept the battery prompt.
   5. In Settings › Battery › Background usage limits, add Kennko POS to **Never sleeping apps**.
   6. Keep the tablet on its charger.
6. **Disconnect the Mac's "Counter till"** in admin › Tills, so production has one till only.
7. **Router:** reserve the Samsung's IP address (DHCP reservation) as the wall's fallback. Note it on the Kennko Wall hidden settings screen only if discovery fails.
8. **Projector:**
   1. Install Kennko Wall.
   2. Open it and press OK once: the board fills from the Samsung.
   3. If PROBE.md says boot start needs it, grant "Display over other apps".
   4. Reboot once to confirm it opens by itself.
9. **Checks:**
   1. Ring a sale: it walks in with a pop.
   2. Mark it Ready: it rings.
   3. Scan the wall QR with a phone: the cat walks in within about 15 s.
   4. Place a paid website order: the chime, banner and badge appear on the Samsung.
   5. Wifi off on the Samsung: selling still works, the Offline pill shows, and the sales send once the wifi is back.
   6. Export backup opens the share sheet.
10. **Next releases:** bump the workspace `version`, build `--release`, upload, run `release-apk.mjs`, and push. The tablet and the projector show "Update available".
