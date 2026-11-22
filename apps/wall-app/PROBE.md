# Projector Probe (Wanbo WPD24)

Tested on-device via ADB (`192.168.1.21:5555`) on 2026-11-22:

- **Device:** SkyworthDigital TV Stick (Wanbo WPD24)
- **Android version:** 11 (SDK 30)
- **WebView package & version:** `com.google.android.webview` `158.0.8127.46`
- **Verdict:** **PASS** (3525 frames in 60 s, 31 SSE frames over NSD `_kennko-pos._tcp.`, all JS/Web Audio/Intl features true, zero uncaught errors)
- **Boot-start behaviour:** `canDrawOverlays: false` on Android 11; `BootReceiver` is installed, and "Display over other apps" should be granted on the projector if Android 11 blocks background activity start on reboot.

Wall engine: system WebView (branch A)
