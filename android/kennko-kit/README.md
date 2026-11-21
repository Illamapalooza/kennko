# kennko-kit

Shared Android library for Kennko POS (`coffee.kennko.pos`) and Kennko Wall (`coffee.kennko.wall`):

- `SqliteBridge` / `SqlitePlugin` (`KennkoSqlite`) — synchronous `androidx.sqlite:sqlite-bundled` bridge
- `WallFeedServer` / `FeedPlugin` (`KennkoFeed`) — LAN SSE wall feed & NSD announcement (Task 10)
- `TillFinder` / `FindPlugin` (`KennkoFind`) — NSD discovery of Kennko POS (Task 12)
- `Kiosk` / `KioskPlugin` (`KennkoKiosk`) — keep screen on & battery exemption (Task 9)
- `UpdateCheck` / `UpdatePlugin` (`KennkoUpdate`) — in-app update check & `PackageInstaller` (Task 13)
