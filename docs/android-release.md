# Kennko Android Release & Go-Live Checklist

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
