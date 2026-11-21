# Kennko POS and Kennko Wall as Android apps — design

Status: approved by Julius · 2026-11-22

## Why

The shop's counter device is a **Samsung Galaxy tablet (Android)**, and the wall runs on a **smart projector (Android
TV)**. Today the till (`apps/pos`) needs a computer to run its Node server and SQLite file, and the wall (`wall/`) is a
Node server plus a browser page. Earlier setup work (`deploy/windows/`) assumed a Windows tablet; that was wrong.

Julius wants Kennko POS to feel like the tablet POS apps staff already know: an app icon on the Samsung that works with
no internet. The wall should run on the projector with nobody typing addresses.

## Goals

- **Kennko POS**, an Android app on the Samsung, is the till: selling, shifts and cash, PINs, the order queue,
  stamps, the free drink, online orders, sold-out switches, menu updates — everything the current till does except
  what is listed under non-goals.
- **Kennko Wall**, an Android TV app on the projector, shows the cafe scene, cats, music, order board, visiting cats
  and the check-in QR.
- Selling never needs the internet. The wall never needs the internet (only the shop wifi).
- No addresses typed, ever, after the first install.
- Updates install over the old version with a tap and keep all data.
- Same behaviour and the same sync contract with the Kennko API as the current till, so the API, website and admin
  don't change.

## Non-goals

- Google Play, iOS, or any public distribution. Both apps are **internal APKs, installed directly** (sideloaded).
- Receipt printing (none for now; can be added later).
- More than one till tablet. One Samsung is the till.
- Importing data from the shop's current third-party POS app.
- Background music on the wall (replaced by sound effects).
- The wall's stand-alone "orders pad" mode (`wall --orders`, `pad.html`), the https certificate and `/setup` page for
  extra tablets, and the old-till legacy import. None apply to a single-tablet Android setup.
- Changes to the Kennko API, website or admin.

## Anti-goals (failure even if it "works")

- An update that loses unsynced sales, or that forces an uninstall.
- The till stopping in the background mid-shift without anyone noticing.
- Staff ever seeing settings, addresses, IPs or a browser.
- The check-in secret leaving the POS app (it must stay as private as it is in the current till).

## Constraints

- Monorepo rules: integer centavos, `type` not `interface`, brand blue `#0055FF`, shared rules in `packages/core`.
- The sync contract with the API (`/v1/devices/*`, `/v1/sync/*`, outbox ordering, clock skew from the `Date` header,
  the pull's check-in secret and visitors) is unchanged; `packages/core` sync types stay the source of truth.
- Internal distribution: one release signing key for both apps, kept outside the repo and backed up by Julius in two
  places. Losing it means every future update needs an uninstall (and the tablet's unsynced data with it).
- The current Node till and Node wall keep working for development and testing on a Mac.

## Approaches considered

1. **Capacitor apps that reuse the existing screens; move the till's server logic into the app.** (Chosen.)
   Capacitor wraps the existing React till screens and the wall scene as Android apps. The till's server modules
   (store, sync, outbox, PINs, sessions, check-in, wall feed, menu) run inside the POS app against an on-device
   SQLite database, behind the same `api.*` calls the screens already make. A small native piece serves the wall feed
   on the shop wifi and announces the tablet on the network.
   *Trade-off:* the server code has to be adapted from Node (`node:sqlite`, `node:crypto`, `http`, files) to the app
   (a SQLite plugin, Web Crypto, in-process calls), and a native plugin is needed for the wifi feed. Most logic and
   every screen are reused.
2. **Embed Node.js inside the app (nodejs-mobile) and run the current server unchanged.** Least porting on paper, but
   the embedded Node is an old version without `node:sqlite`, it makes a heavy APK, the project is thinly maintained,
   and the app would still run an HTTP server on the tablet. Rejected: fragile foundation for a cash register.
3. **Rewrite both apps natively in Kotlin.** Most robust Android behaviour, but throws away the existing screens and
   logic and doubles the code to maintain. Rejected: far more work for no gain the shop would see.

## The design

```
 Samsung tablet — Kennko POS (Capacitor)               Projector — Kennko Wall (Capacitor, Android TV)
 ├─ till screens (existing React UI)                   ├─ cafe scene, cats, sprites (existing wall code)
 ├─ in-app "till core": SQLite, outbox, sync,          ├─ music from the projector's storage
 │  PINs, sessions, check-in, menu, wall feed          └─ finds the POS on the wifi, follows its feed
 ├─ native: wifi feed (HTTP/SSE) + network announce  ── shop wifi ──►
 └─ HTTPS to the Kennko API when online
```

### Kennko POS (tablet)

- **Screens:** the existing `apps/pos/src` React screens, unchanged in look and flow. `api.ts` keeps its function
  names; underneath, calls go to the in-app till core instead of `fetch('/api/…')`. The PIN gate, per-person PINs,
  the manager-PIN prompts and every screen behave as today.
- **Till core:** the logic now in `apps/pos/server` (store and schema, outbox and sync loop, Kennko API client,
  device pairing, PIN directory and lockout, sessions, menu, check-in code and QR, wall feed, day report) moves into a
  module the app runs in-process. The SQLite schema and migrations carry over. Shared pieces stay in `packages/core`;
  logic that both the Node till and the app need is factored so the Mac version keeps working.
- **Storage:** the database lives in the app's private storage. The device token and the check-in secret live there
  too (not in a file a backup or share could pick up). A daily backup copy is kept in app storage; staff or the owner
  can **Export backup** through Android's share sheet. Sync to Kennko remains the real off-tablet copy.
- **New online orders get noticed (Julius chose this over push into the app).** Online orders still arrive by the
  sync pull (about every 15 seconds while the app is on screen), as today. New in the app: when a pull brings an online
  order the till hasn't shown before, it plays a **chime**, shows a **banner** ("New online order W3", tap to open
  Orders) and keeps a **count badge** on the Orders tab until Orders is opened. Not on first load after connecting, and
  not again for the same order. While the tablet sleeps, nothing arrives until it wakes (then at once). For that gap
  the shop uses the existing website **Order alerts** (web push) on a manager's or the owner's phone, or on the tablet
  in Chrome; no push into the POS app itself (no Firebase).
- **Card QR scanning:** the camera scanning the till already has keeps working (Capacitor camera permission; a native
  scanner plugin is acceptable if the web scanner is unreliable on the Samsung). Typing the code always works.
- **Always on, and safe when it isn't (Julius: the till is on screen most of the day, but the tablet sometimes
  sleeps on its own).** No background service: the till core runs while the app is on screen. To keep it there, the
  app keeps the screen awake while open, asks once to be excluded from battery optimisation, and the setup notes tell
  the owner to add it to Samsung's "never sleeping apps" and to keep the tablet charging. When the tablet does sleep
  or the app is in the background, sync, online orders and the wall feed pause; nothing is lost (every sale is already
  in SQLite and the outbox). **On waking or returning to the app it catches up at once:** an immediate sync, a fresh
  check-in code, and the wall feed resumes. While the feed is down the wall already clears the check-in QR (current
  behaviour when the till goes away), so customers never scan a stale code. If Android kills the app, it reopens to
  the PIN gate with all data intact.
- **Wifi feed for the wall:** a native Capacitor plugin runs a small HTTP server on the shop wifi serving the same
  wall feed the current till serves (`/api/wall/events` as server-sent events, `/api/wall/menu`), same JSON shape, so
  the wall's logic doesn't change. It announces itself on the network (Android network service discovery) as a Kennko
  POS service. The feed carries only what it carries today (orders for the board, menu names, `{url, modules}` for the
  QR, visitors as key/name/look/end time) — never the secret, staff or customer details.
- **Connecting to Kennko, and the first run (builder's call, Julius may correct).** There is no `config.json` on the
  tablet. A fresh install opens to **Connect this till**: the owner types the 6-digit code from admin › Tills, and
  that code (only an owner can make one) is the authority, so the app ships with **no built-in PINs** and no selling
  is possible before it is connected. After connecting, staff sign in with their own PINs from admin › Staff, as the
  paired Node till does today. The production API address is built into the release build (a debug build may point
  elsewhere). Shop name, address, phone and discount presets come from Kennko in the pull, as they already do. If the
  owner disconnects the tablet in admin, it keeps selling with the PINs it has (current behaviour) until reconnected.

### Kennko Wall (projector)

- **Device:** Wanbo WPD24 projector (Julius). The shop notes say it runs Android TV with Google Play and has no Chrome
  (staff used the TV Bro browser). The wall app depends on the projector's System WebView being modern enough for the
  existing scene (ES modules, EventSource, canvas). **The first plan task is a probe APK** that reports the projector's
  Android version and WebView version and draws a test scene; if the WebView is too old or can't be updated through
  Play, the wall app bundles its own web engine (for example GeckoView) instead of the system one. The plan must not
  build the rest of the wall app before this is known.
- **Scene:** the existing `wall/public` scene (cats, sprites, order board, visiting cats, QR card) packaged as an
  Android TV app that opens full screen, landscape, with the screen kept on, and can be set to open when the projector
  starts. Remote-friendly: the one "tap to start" press works with the remote's OK button.
- **Finding the tablet:** discovers the Kennko POS service on the wifi automatically and follows its feed. If none
  is found it says so on screen in plain words and keeps looking. A manual address field, reachable from a hidden
  settings screen, is the fallback (with the tablet's address reserved in the router).
- **Offline behaviour:** same as today's wall: keeps playing, keeps the last orders, ages the till's clock while the
  feed is down, and reconnects by itself.
- **Sound effects, no music (Julius).** The wall's background-music player is dropped. Instead the wall plays short,
  friendly sound effects for what happens in the scene: a new order joining the line, an order moving to preparing,
  an order ready to collect, a visiting cat walking in, and a cat leaving. Effects are made in code with the Web
  Audio API (no audio files, nothing to license), quiet by default, with a mute toggle on the hidden settings screen.
  The "press OK once to start" step stays, because Android TV only allows sound after one remote press.

### Updates (both apps)

- Each app checks a small JSON file on `kennko.vercel.app` (latest version number, download URL, notes) at start and
  daily. When newer, it shows "Update available"; staff tap **Update**, Android shows its Install prompt, and the new
  version installs over the old one, keeping data.
- APK files are hosted at an unlisted URL (not in git). Exact host is the builder's choice within: not a public
  listing, reachable from the shop without logging in, no new paid service.
- Version codes always increase; both apps are signed with the one Kennko release key.

### Development and release

- Builds run on Julius's Mac (Android SDK + JDK; Capacitor/Gradle). Debug builds for testing; signed release builds
  for the shop. Testing on an Android emulator, then on the Samsung and the projector.
- The current Node till and wall stay runnable for development. Repo docs (`apps/pos/README.md`, `wall/README.md`,
  the admin Guide) are updated for the Android setup, and `deploy/windows/` is retired or clearly marked as not used.

## Decided by Julius (continued below)

- Two internal APKs: Kennko POS (tablet) and Kennko Wall (projector), sideloaded, never on a store.
- One till tablet.
- The wall runs as its own app on the projector and gets live data from the tablet over the shop wifi (works without
  internet).
- No receipt printing for now.
- No import from the current POS app.
- The tablet is on Kennko POS most of the day but may sleep on its own; it must recover cleanly (see Always on).
- Projector: Wanbo WPD24.
- No wall music; sound effects for actions in the scene instead.
- New online orders: chime, banner and Orders badge in the POS app; website Order alerts cover the tablet asleep.
  No push into the POS app.

## Builder's calls Julius can correct

- First run requires Connect this till; no built-in PINs; production API address built into release builds.
- **Julius's Mac till** (currently paired to production as "Counter till") stays connected only until the Samsung
  goes live, then is disconnected in admin › Tills, so production only ever has one till. Its data is test data (the
  database was reset on 2026-11-21); the Samsung starts fresh. For development after go-live, the Node till uses a
  debug build's own pairing or a non-production API.

## Left to the builder

- Library choices within Capacitor (SQLite plugin, wifi HTTP server and discovery implementation, scanner plugin).
- How the till core is shared between the Node till and the app (one module with a storage adapter, or similar).
- The update JSON shape and APK hosting, within the constraints above.
- Plan task order. Suggested: till core extraction with storage adapter → POS app shell running the core → wifi
  feed plugin and discovery → wall app → updates → release signing and setup docs.

## Open items

- The Samsung tablet's model and Android version (for testing; not needed to plan).
- The projector probe result (first plan task) decides between the system WebView and a bundled engine for the wall.
